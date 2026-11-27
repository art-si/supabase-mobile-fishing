-- The public catalog contains only verified, dated evidence and a matched place.
-- Existing cards keep their names/interaction keys but wait for source verification.
alter table public.fishing_spot_leads
  add column catalog_status text not null default 'review' check (catalog_status in ('review','published','withdrawn')),
  add column verified_at timestamptz,
  add column valid_until timestamptz;

drop policy if exists fishing_spot_leads_read on public.fishing_spot_leads;
drop policy if exists fishing_spot_leads_public on public.fishing_spot_leads;
do $policies$
declare p record;
begin
  for p in select policyname from pg_policies where schemaname='public' and tablename='fishing_spot_leads'
  loop execute format('drop policy %I on public.fishing_spot_leads',p.policyname); end loop;
end $policies$;
create policy fishing_spot_leads_verified on public.fishing_spot_leads for select to anon,authenticated
  using (catalog_status='published' and valid_until > now());

create index fishing_spot_leads_poi_idx on public.fishing_spot_leads(city,(card->>'poiId'))
  where card->>'poiId' is not null;
create or replace function public.fishing_list_spot_leads(city_name text) returns jsonb
language sql stable security invoker set search_path='' as $$
  select coalesce(jsonb_agg(card order by verified_at desc, name),'[]'::jsonb)
  from public.fishing_spot_leads
  where city in (city_name,city_name || '市') and catalog_status='published' and valid_until>now()
$$;

create table fishing_private.spot_source_jobs (
  id uuid primary key default gen_random_uuid(),
  city text not null check (city ~ '^[一-鿿]{2,20}$'),
  url text not null check (length(url) between 12 and 500 and url ~ '^https://[a-z0-9.-]+/'),
  state text not null default 'queued' check (state in ('queued','processing','published','review','blocked','failed')),
  lease uuid, lease_until timestamptz,
  attempts integer not null default 0 check(attempts>=0),
  next_check timestamptz not null default now(),
  checked_at timestamptz, reason text not null default '',
  http_status integer not null default 0,
  content_hash text not null default '',
  result_count integer not null default 0,
  created_at timestamptz not null default now(),
  unique(city,url)
);
create index spot_source_jobs_due_idx on fishing_private.spot_source_jobs(next_check,id);
alter table fishing_private.spot_source_jobs enable row level security;
revoke all on fishing_private.spot_source_jobs from public,anon,authenticated;
grant select,insert,update,delete on fishing_private.spot_source_jobs to service_role;

create table fishing_private.spot_source_cities (
  city text primary key check (city ~ '^[一-鿿]{2,20}$'),
  next_search timestamptz not null default now(),
  checked_at timestamptz, reason text not null default '',
  lease uuid, lease_until timestamptz
);
create index spot_source_cities_due_idx on fishing_private.spot_source_cities(next_search,city);
alter table fishing_private.spot_source_cities enable row level security;
revoke all on fishing_private.spot_source_cities from public,anon,authenticated;
grant select,insert,update,delete on fishing_private.spot_source_cities to service_role;

create function public.fishing_spot_source_city_names() returns jsonb
language sql stable security invoker set search_path='' as $$
  select coalesce(jsonb_agg(city order by city),'[]'::jsonb) from fishing_private.spot_source_cities
$$;
revoke all on function public.fishing_spot_source_city_names() from public,anon,authenticated;
grant execute on function public.fishing_spot_source_city_names() to service_role;

create table fishing_private.spot_source_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  summary jsonb not null default '{}'::jsonb
);
alter table fishing_private.spot_source_runs enable row level security;
revoke all on fishing_private.spot_source_runs from public,anon,authenticated;
grant select,insert,delete on fishing_private.spot_source_runs to service_role;

create function public.fishing_enqueue_spot_sources(sources jsonb) returns integer
language plpgsql security invoker set search_path='' as $$
declare entry jsonb; changed integer:=0; inserted integer;
begin
  if jsonb_typeof(sources) is distinct from 'array' or jsonb_array_length(sources)>100 then
    raise exception 'INVALID_INPUT' using errcode='22023';
  end if;
  for entry in select value from jsonb_array_elements(sources) loop
    insert into fishing_private.spot_source_cities(city) values(entry->>'city') on conflict do nothing;
    insert into fishing_private.spot_source_jobs(city,url) values(entry->>'city',entry->>'url') on conflict do nothing;
    get diagnostics inserted=row_count;
    changed:=changed+inserted;
  end loop;
  return changed;
end $$;

create function public.fishing_claim_spot_sources() returns jsonb
language plpgsql security invoker set search_path='' as $$
declare claimed jsonb; city_jobs jsonb;
begin
  with due as (
    select id from fishing_private.spot_source_jobs
    where next_check<=now() and (lease_until is null or lease_until<now())
    order by next_check,id limit 3 for update skip locked
  ), jobs as (
    update fishing_private.spot_source_jobs j set state='processing',lease=gen_random_uuid(),lease_until=now()+interval '5 minutes',attempts=attempts+1
    from due where j.id=due.id returning j.id,j.city,j.url,j.lease,j.attempts
  ) select coalesce(jsonb_agg(to_jsonb(jobs)),'[]'::jsonb) into claimed from jobs;
  with due as (
    select city from fishing_private.spot_source_cities
    where next_search<=now() and (lease_until is null or lease_until<now())
    order by next_search,city limit 1 for update skip locked
  ), jobs as (
    update fishing_private.spot_source_cities c set lease=gen_random_uuid(),lease_until=now()+interval '5 minutes'
    from due where c.city=due.city returning c.city,c.lease
  ) select coalesce(jsonb_agg(to_jsonb(jobs)),'[]'::jsonb) into city_jobs from jobs;
  return jsonb_build_object('sources',claimed,'cities',city_jobs);
end $$;

create function public.fishing_finish_spot_source(job_id uuid,lease_token uuid,result jsonb) returns boolean
language plpgsql security invoker set search_path='' as $$
declare job fishing_private.spot_source_jobs; entry jsonb; previous public.fishing_spot_leads;
  state_name text:=result->>'state'; canonical_name text; merged jsonb;
begin
  select * into job from fishing_private.spot_source_jobs where id=job_id and lease=lease_token and lease_until>now() for update;
  if not found then return false; end if;
  if state_name not in ('published','review','blocked','failed') or state_name is null or
    length(coalesce(result->>'reason',''))>100 then raise exception 'INVALID_RESULT' using errcode='22023'; end if;
  if state_name='published' then
    if jsonb_typeof(result->'cards') is distinct from 'array' or jsonb_array_length(result->'cards') not between 1 and 6 then
      raise exception 'INVALID_CARDS' using errcode='22023';
    end if;
    for entry in select value from jsonb_array_elements(result->'cards') loop
      if entry->>'city' is distinct from job.city or entry->'source'->>'url' is distinct from job.url or
        length(coalesce(entry->>'name','')) not between 2 and 40 or
        length(coalesce(entry->>'evidence','')) not between 4 and 90 or
        entry->>'waterType' is distinct from '钓场' or
        jsonb_typeof(entry->'sourcePosition'->'longitude') is distinct from 'number' or
        jsonb_typeof(entry->'sourcePosition'->'latitude') is distinct from 'number' or
        entry->'sourcePosition'->>'crs' is distinct from 'GCJ-02' or
        not ((entry->'sourcePosition'->>'longitude')::numeric between 73 and 136) or
        not ((entry->'sourcePosition'->>'latitude')::numeric between 3 and 54) or
        coalesce(entry->>'poiId','') !~ '^[A-Za-z0-9]{5,40}$' then
        raise exception 'UNVERIFIED_CARD' using errcode='22023';
      end if;
      -- A POI has one canonical card in a city. Keep its old name so likes, comments
      -- and bookmarks continue to use the same lead:city|name community key.
      select * into previous from public.fishing_spot_leads l
        where l.city=job.city and (l.name=entry->>'name' or l.card->>'poiId'=entry->>'poiId' or
          coalesce(l.card->>'poiQuery',l.name) in (entry->>'poiQuery',entry->>'name'))
        order by (l.name=entry->>'name') desc,l.name limit 1;
      canonical_name:=coalesce(previous.name,entry->>'name');
      select coalesce(jsonb_agg(link),'[]'::jsonb) into merged from (
        select distinct on (rtrim(link->>'url','/')) link
        from jsonb_array_elements(coalesce(previous.card->'relatedSources','[]') ||
          case when previous.card is null then '[]'::jsonb else jsonb_build_array(previous.card->'source') end ||
          coalesce(entry->'relatedSources','[]')) as links(link)
        where link->>'url' is not null and rtrim(link->>'url','/')<>rtrim(job.url,'/')
        order by rtrim(link->>'url','/') limit 12
      ) links;
      entry:=entry || jsonb_build_object('name',canonical_name,'verifiedAt',now(),'relatedSources',merged);
      insert into public.fishing_spot_leads(city,name,card,catalog_status,verified_at,valid_until)
        values(job.city,canonical_name,entry,'published',now(),now()+interval '14 days')
      on conflict(city,name) do update set card=excluded.card,catalog_status='published',verified_at=now(),valid_until=excluded.valid_until;
      perform public.fishing_store_spot_lead_point(job.city,canonical_name,
        (entry->'sourcePosition'->>'longitude')::double precision,(entry->'sourcePosition'->>'latitude')::double precision);
    end loop;
    update public.fishing_spot_leads l set catalog_status='review'
      where l.city=job.city and l.card->'source'->>'url'=job.url and l.catalog_status='published'
        and not exists(select 1 from jsonb_array_elements(result->'cards') as cards(c) where c->>'poiId'=l.card->>'poiId');
  elsif state_name in ('review','blocked') then
    update public.fishing_spot_leads set catalog_status=case when result->>'reason' in ('fishing_restriction','source_http_404','source_http_410','venue_closed') then 'withdrawn' else 'review' end
    where city=job.city and card->'source'->>'url'=job.url;
  end if;
  update fishing_private.spot_source_jobs set state=state_name,lease=null,lease_until=null,checked_at=now(),
    reason=coalesce(result->>'reason',''),http_status=coalesce((result->>'httpStatus')::integer,0),
    content_hash=coalesce(result->>'hash',''),result_count=coalesce(jsonb_array_length(result->'cards'),0),
    next_check=now()+case when state_name='failed' then least(interval '7 days',interval '10 minutes'*power(2,least(attempts,10)))
      when state_name='published' then interval '7 days' else interval '30 days' end
    where id=job_id;
  return true;
end $$;

create function public.fishing_finish_spot_city(city_name text,lease_token uuid,outcome text) returns boolean
language plpgsql security invoker set search_path='' as $$
begin
  if outcome not in ('ready','search_unconfigured','search_failed','storage_permission_required') then
    raise exception 'INVALID_RESULT' using errcode='22023'; end if;
  update fishing_private.spot_source_cities set checked_at=now(),reason=outcome,lease=null,lease_until=null,
    next_search=now()+case when outcome='search_failed' then interval '6 hours' else interval '1 day' end
    where city=city_name and lease=lease_token and lease_until>now();
  return found;
end $$;

create function public.fishing_spot_source_run(summary jsonb) returns void
language plpgsql security invoker set search_path='' as $$
begin
  insert into fishing_private.spot_source_runs(summary) values(summary);
  delete from fishing_private.spot_source_runs where started_at<now()-interval '30 days';
end $$;

revoke all on function public.fishing_enqueue_spot_sources(jsonb),public.fishing_claim_spot_sources(),
  public.fishing_finish_spot_source(uuid,uuid,jsonb),public.fishing_finish_spot_city(text,uuid,text),public.fishing_spot_source_run(jsonb) from public,anon,authenticated;
grant execute on function public.fishing_enqueue_spot_sources(jsonb),public.fishing_claim_spot_sources(),
  public.fishing_finish_spot_source(uuid,uuid,jsonb),public.fishing_finish_spot_city(text,uuid,text),public.fishing_spot_source_run(jsonb) to service_role;

-- Previously imported shares are staged too; unsupported/login-only media waits
-- for an authorized supply rather than treating a search snippet as verified.
-- Legacy service import now stages sources rather than publishing unchecked excerpts.
create or replace function public.fishing_publish_spot_leads(cards jsonb) returns integer
language plpgsql security invoker set search_path='' as $$
begin
  if jsonb_typeof(cards) is distinct from 'array' or jsonb_array_length(cards) not between 1 and 6 then
    raise exception 'INVALID_INPUT' using errcode='22023';
  end if;
  return public.fishing_enqueue_spot_sources((select jsonb_agg(distinct jsonb_build_object('city',entry->>'city','url',source->>'url'))
    from jsonb_array_elements(cards) entry cross join lateral
      jsonb_array_elements(jsonb_build_array(entry->'source')||coalesce(entry->'relatedSources','[]')) source));
end $$;

insert into fishing_private.spot_source_cities(city) select distinct city from public.fishing_spot_leads on conflict do nothing;
-- Names mirror src/domain/data/cities.json; visitors cannot enqueue crawling work.
insert into fishing_private.spot_source_cities(city) values
  ('北京市'),
  ('天津市'),
  ('石家庄市'),
  ('唐山市'),
  ('秦皇岛市'),
  ('邯郸市'),
  ('邢台市'),
  ('保定市'),
  ('张家口市'),
  ('承德市'),
  ('沧州市'),
  ('廊坊市'),
  ('衡水市'),
  ('太原市'),
  ('大同市'),
  ('阳泉市'),
  ('长治市'),
  ('晋城市'),
  ('朔州市'),
  ('晋中市'),
  ('运城市'),
  ('忻州市'),
  ('临汾市'),
  ('吕梁市'),
  ('呼和浩特市'),
  ('包头市'),
  ('乌海市'),
  ('赤峰市'),
  ('通辽市'),
  ('鄂尔多斯市'),
  ('呼伦贝尔市'),
  ('巴彦淖尔市'),
  ('乌兰察布市'),
  ('兴安盟'),
  ('锡林郭勒盟'),
  ('阿拉善盟'),
  ('沈阳市'),
  ('大连市'),
  ('鞍山市'),
  ('抚顺市'),
  ('本溪市'),
  ('丹东市'),
  ('锦州市'),
  ('营口市'),
  ('阜新市'),
  ('辽阳市'),
  ('盘锦市'),
  ('铁岭市'),
  ('朝阳市'),
  ('葫芦岛市'),
  ('长春市'),
  ('吉林市'),
  ('四平市'),
  ('辽源市'),
  ('通化市'),
  ('白山市'),
  ('松原市'),
  ('白城市'),
  ('延边朝鲜族自治州'),
  ('哈尔滨市'),
  ('齐齐哈尔市'),
  ('鸡西市'),
  ('鹤岗市'),
  ('双鸭山市'),
  ('大庆市'),
  ('伊春市'),
  ('佳木斯市'),
  ('七台河市'),
  ('牡丹江市'),
  ('黑河市'),
  ('绥化市'),
  ('大兴安岭地区'),
  ('上海市'),
  ('南京市'),
  ('无锡市'),
  ('徐州市'),
  ('常州市'),
  ('苏州市'),
  ('南通市'),
  ('连云港市'),
  ('淮安市'),
  ('盐城市'),
  ('扬州市'),
  ('镇江市'),
  ('泰州市'),
  ('宿迁市'),
  ('杭州市'),
  ('宁波市'),
  ('温州市'),
  ('嘉兴市'),
  ('湖州市'),
  ('绍兴市'),
  ('金华市'),
  ('衢州市'),
  ('舟山市'),
  ('台州市'),
  ('丽水市'),
  ('合肥市'),
  ('芜湖市'),
  ('蚌埠市'),
  ('淮南市'),
  ('马鞍山市'),
  ('淮北市'),
  ('铜陵市'),
  ('安庆市'),
  ('黄山市'),
  ('滁州市'),
  ('阜阳市'),
  ('宿州市'),
  ('六安市'),
  ('亳州市'),
  ('池州市'),
  ('宣城市'),
  ('福州市'),
  ('厦门市'),
  ('莆田市'),
  ('三明市'),
  ('泉州市'),
  ('漳州市'),
  ('南平市'),
  ('龙岩市'),
  ('宁德市'),
  ('南昌市'),
  ('景德镇市'),
  ('萍乡市'),
  ('九江市'),
  ('新余市'),
  ('鹰潭市'),
  ('赣州市'),
  ('吉安市'),
  ('宜春市'),
  ('抚州市'),
  ('上饶市'),
  ('济南市'),
  ('青岛市'),
  ('淄博市'),
  ('枣庄市'),
  ('东营市'),
  ('烟台市'),
  ('潍坊市'),
  ('济宁市'),
  ('泰安市'),
  ('威海市'),
  ('日照市'),
  ('临沂市'),
  ('德州市'),
  ('聊城市'),
  ('滨州市'),
  ('菏泽市'),
  ('郑州市'),
  ('开封市'),
  ('洛阳市'),
  ('平顶山市'),
  ('安阳市'),
  ('鹤壁市'),
  ('新乡市'),
  ('焦作市'),
  ('濮阳市'),
  ('许昌市'),
  ('漯河市'),
  ('三门峡市'),
  ('南阳市'),
  ('商丘市'),
  ('信阳市'),
  ('周口市'),
  ('驻马店市'),
  ('济源市'),
  ('武汉市'),
  ('黄石市'),
  ('十堰市'),
  ('宜昌市'),
  ('襄阳市'),
  ('鄂州市'),
  ('荆门市'),
  ('孝感市'),
  ('荆州市'),
  ('黄冈市'),
  ('咸宁市'),
  ('随州市'),
  ('恩施土家族苗族自治州'),
  ('仙桃市'),
  ('潜江市'),
  ('天门市'),
  ('神农架林区'),
  ('长沙市'),
  ('株洲市'),
  ('湘潭市'),
  ('衡阳市'),
  ('邵阳市'),
  ('岳阳市'),
  ('常德市'),
  ('张家界市'),
  ('益阳市'),
  ('郴州市'),
  ('永州市'),
  ('怀化市'),
  ('娄底市'),
  ('湘西土家族苗族自治州'),
  ('广州市'),
  ('韶关市'),
  ('深圳市'),
  ('珠海市'),
  ('汕头市'),
  ('佛山市'),
  ('江门市'),
  ('湛江市'),
  ('茂名市'),
  ('肇庆市'),
  ('惠州市'),
  ('梅州市'),
  ('汕尾市'),
  ('河源市'),
  ('阳江市'),
  ('清远市'),
  ('东莞市'),
  ('中山市'),
  ('潮州市'),
  ('揭阳市'),
  ('云浮市'),
  ('南宁市'),
  ('柳州市'),
  ('桂林市'),
  ('梧州市'),
  ('北海市'),
  ('防城港市'),
  ('钦州市'),
  ('贵港市'),
  ('玉林市'),
  ('百色市'),
  ('贺州市'),
  ('河池市'),
  ('来宾市'),
  ('崇左市'),
  ('海口市'),
  ('三亚市'),
  ('三沙市'),
  ('儋州市'),
  ('五指山市'),
  ('琼海市'),
  ('文昌市'),
  ('万宁市'),
  ('东方市'),
  ('定安县'),
  ('屯昌县'),
  ('澄迈县'),
  ('临高县'),
  ('白沙黎族自治县'),
  ('昌江黎族自治县'),
  ('乐东黎族自治县'),
  ('陵水黎族自治县'),
  ('保亭黎族苗族自治县'),
  ('琼中黎族苗族自治县'),
  ('重庆市'),
  ('成都市'),
  ('自贡市'),
  ('攀枝花市'),
  ('泸州市'),
  ('德阳市'),
  ('绵阳市'),
  ('广元市'),
  ('遂宁市'),
  ('内江市'),
  ('乐山市'),
  ('南充市'),
  ('眉山市'),
  ('宜宾市'),
  ('广安市'),
  ('达州市'),
  ('雅安市'),
  ('巴中市'),
  ('资阳市'),
  ('阿坝藏族羌族自治州'),
  ('甘孜藏族自治州'),
  ('凉山彝族自治州'),
  ('贵阳市'),
  ('六盘水市'),
  ('遵义市'),
  ('安顺市'),
  ('毕节市'),
  ('铜仁市'),
  ('黔西南布依族苗族自治州'),
  ('黔东南苗族侗族自治州'),
  ('黔南布依族苗族自治州'),
  ('昆明市'),
  ('曲靖市'),
  ('玉溪市'),
  ('保山市'),
  ('昭通市'),
  ('丽江市'),
  ('普洱市'),
  ('临沧市'),
  ('楚雄彝族自治州'),
  ('红河哈尼族彝族自治州'),
  ('文山壮族苗族自治州'),
  ('西双版纳傣族自治州'),
  ('大理白族自治州'),
  ('德宏傣族景颇族自治州'),
  ('怒江傈僳族自治州'),
  ('迪庆藏族自治州'),
  ('拉萨市'),
  ('日喀则市'),
  ('昌都市'),
  ('林芝市'),
  ('山南市'),
  ('那曲市'),
  ('阿里地区'),
  ('西安市'),
  ('铜川市'),
  ('宝鸡市'),
  ('咸阳市'),
  ('渭南市'),
  ('延安市'),
  ('汉中市'),
  ('榆林市'),
  ('安康市'),
  ('商洛市'),
  ('兰州市'),
  ('嘉峪关市'),
  ('金昌市'),
  ('白银市'),
  ('天水市'),
  ('武威市'),
  ('张掖市'),
  ('平凉市'),
  ('酒泉市'),
  ('庆阳市'),
  ('定西市'),
  ('陇南市'),
  ('临夏回族自治州'),
  ('甘南藏族自治州'),
  ('西宁市'),
  ('海东市'),
  ('海北藏族自治州'),
  ('黄南藏族自治州'),
  ('海南藏族自治州'),
  ('果洛藏族自治州'),
  ('玉树藏族自治州'),
  ('海西蒙古族藏族自治州'),
  ('银川市'),
  ('石嘴山市'),
  ('吴忠市'),
  ('固原市'),
  ('中卫市'),
  ('乌鲁木齐市'),
  ('克拉玛依市'),
  ('吐鲁番市'),
  ('哈密市'),
  ('昌吉回族自治州'),
  ('博尔塔拉蒙古自治州'),
  ('巴音郭楞蒙古自治州'),
  ('阿克苏地区'),
  ('克孜勒苏柯尔克孜自治州'),
  ('喀什地区'),
  ('和田地区'),
  ('伊犁哈萨克自治州'),
  ('塔城地区'),
  ('阿勒泰地区'),
  ('石河子市'),
  ('阿拉尔市'),
  ('图木舒克市'),
  ('五家渠市'),
  ('北屯市'),
  ('铁门关市'),
  ('双河市'),
  ('可克达拉市'),
  ('昆玉市'),
  ('胡杨河市'),
  ('新星市'),
  ('白杨市'),
  ('台北市'),
  ('高雄市'),
  ('台南市'),
  ('台中市'),
  ('金门县'),
  ('南投县'),
  ('基隆市'),
  ('新竹市'),
  ('嘉义市'),
  ('新北市'),
  ('宜兰县'),
  ('新竹县'),
  ('桃园市'),
  ('苗栗县'),
  ('彰化县'),
  ('嘉义县'),
  ('云林县'),
  ('屏东县'),
  ('台东县'),
  ('花莲县'),
  ('澎湖县'),
  ('连江县'),
  ('香港特别行政区'),
  ('澳门特别行政区')
on conflict do nothing;
insert into fishing_private.spot_source_jobs(city,url)
  select distinct city,source->>'url' from public.fishing_spot_leads cross join lateral
    jsonb_array_elements(jsonb_build_array(card->'source')||coalesce(card->'relatedSources','[]')) source on conflict do nothing;

create function public.fishing_spot_worker_authorized(worker_token text) returns boolean
language plpgsql security invoker set search_path='' as $$
begin
  if length(worker_token)<>64 then return false; end if;
  return exists(select 1 from vault.decrypted_secrets where name='fishing_spot_source_worker' and decrypted_secret=worker_token);
end $$;
revoke all on function public.fishing_spot_worker_authorized(text) from public,anon,authenticated;
grant execute on function public.fishing_spot_worker_authorized(text) to service_role;

create function fishing_private.dispatch_spot_sources() returns bigint
language plpgsql security invoker set search_path='' as $$
declare token text; request_id bigint;
begin
  select decrypted_secret into token from vault.decrypted_secrets where name='fishing_spot_source_worker';
  if token is null then raise exception 'WORKER_NOT_CONFIGURED'; end if;
  select net.http_post(url:='https://jupuypvmgjpnpntfetqv.supabase.co/functions/v1/spot-source-sync',
    headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||token),
    body:='{}'::jsonb,timeout_milliseconds:=120000) into request_id;
  return request_id;
end $$;
revoke all on function fishing_private.dispatch_spot_sources() from public,anon,authenticated,service_role;

do $schedule$
begin
  -- Hosted-only infrastructure. Local contract tests exercise queue leases/RLS.
  if exists(select 1 from pg_namespace where nspname='vault') and exists(select 1 from pg_namespace where nspname='cron') then
    if not exists(select 1 from vault.secrets where name='fishing_spot_source_worker') then
      perform vault.create_secret(replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-',''),'fishing_spot_source_worker');
    end if;
    perform cron.schedule('fishing-spot-source-sync','*/5 * * * *','select fishing_private.dispatch_spot_sources()');
  end if;
end $schedule$;

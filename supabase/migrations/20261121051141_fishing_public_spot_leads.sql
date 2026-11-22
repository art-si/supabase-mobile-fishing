create table public.fishing_spot_leads (
  city text not null check (char_length(city) between 2 and 20),
  name text not null check (char_length(name) between 2 and 120),
  card jsonb not null check (
    jsonb_typeof(card) = 'object'
    and (card->>'city') is not distinct from city
    and (card->>'name') is not distinct from name
    and jsonb_typeof(card->'source') is not distinct from 'object'
    and jsonb_typeof(card->'labels') is not distinct from 'object'
  ),
  primary key (city, name)
);

comment on table public.fishing_spot_leads is
  'Editorially verified fishing places and their public sources. Each card follows the SpotLead contract.';

alter table public.fishing_spot_leads enable row level security;
revoke all on public.fishing_spot_leads from public, anon, authenticated;
grant select on public.fishing_spot_leads to anon, authenticated;
grant select, insert, update, delete on public.fishing_spot_leads to service_role;

create policy "Read published fishing leads"
  on public.fishing_spot_leads for select to anon, authenticated using (true);

create function public.fishing_list_spot_leads(city_name text)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $list$
  select coalesce(jsonb_agg(lead.card order by lead.card->>'sourceDate' desc, lead.name), '[]'::jsonb)
  from public.fishing_spot_leads as lead
  where lead.city in (city_name, city_name || '市');
$list$;

revoke all on function public.fishing_list_spot_leads(text) from public, anon, authenticated;
grant execute on function public.fishing_list_spot_leads(text) to anon, authenticated, service_role;

insert into public.fishing_spot_leads (city, name, card)
select card->>'city', card->>'name', card
from jsonb_array_elements($catalog$
[
  {"name":"杉野灵溪休闲垂钓区","city":"武汉市","waterType":"钓场","poiQuery":"杉野灵溪","district":"东西湖区","sourceAddress":"武汉市东西湖区慈惠街道乡伴慈惠景区","labels":{"setting":"园区有浅滩、休憩座椅和休闲垂钓区。","family":"亲子营地设浅滩戏水和萌宠互动区。"},"source":{"platform":"public","publisher":"武汉生态环境局","url":"https://hbj.wuhan.gov.cn/hjxw/202610/t20261008_2857123.html"},"relatedSources":[{"platform":"douyin","url":"https://www.douyin.com/video/7682647620952061803"},{"platform":"toutiao","url":"https://www.toutiao.com/article/7555732732966470154/"}],"sourceDate":"2026-10-03"},
  {"name":"仙耕道谷垂钓区","city":"武汉市","waterType":"钓场","poiQuery":"仙耕道谷","district":"黄陂区","sourceAddress":"武汉市黄陂区蔡店街张河村","labels":{"setting":"垂钓区在张河村的田园综合体，附近有山林与溪流。"},"source":{"platform":"public","publisher":"武汉农业农村局","url":"https://nyncj.wuhan.gov.cn/xwzx_25/whsn/202609/t20260916_2848922.html"},"sourceDate":"2026-09-16"},
  {"name":"巨龙湖生态园垂钓区","city":"武汉市","waterType":"钓场","poiQuery":"巨龙湖生态园","district":"东西湖区","sourceAddress":"武汉市东西湖区遮湖岗258号","labels":{"setting":"湖北日报记录了园内的湖畔景观和垂钓活动。","parking":"园区内提供免费停车。","family":"园区可露营、钓鱼和钓虾，报道将其列为家庭出游去处。"},"source":{"platform":"media","publisher":"湖北日报","url":"https://news.hubeidaily.net/mobile/c_5466306.html"},"sourceDate":"2026-05-06"},
  {"name":"小奓湖休闲垂钓基地","city":"武汉市","waterType":"钓场","district":"黄陂区","sourceAddress":"武汉市黄陂区武湖街道中心路五七分场附近","labels":{"setting":"钓场资料介绍场地约25亩，并提到周边环境优美。"},"source":{"platform":"media","publisher":"钓鱼之家","url":"https://m.diaoyu.com/diaochang/wuhan/200577.html"},"sourceDate":""},
  {"name":"空港湿地花田垂钓区","city":"武汉市","waterType":"钓场","poiQuery":"武汉农业集团空港湿地花田","district":"东西湖区","sourceAddress":"武汉市东西湖区柏泉街道银柏东路","labels":{"parking":"园区入口提供免费停车。","family":"园内安排了萌宠互动和户外运动，垂钓需要自带钓具。"},"source":{"platform":"media","publisher":"湖北日报","url":"https://news.hubeidaily.net/mobile/c_5466306.html"},"sourceDate":"2026-05-06"},
  {"name":"枕山栖谷垂钓区","city":"武汉市","waterType":"钓场","poiQuery":"武汉枕山栖谷","district":"东西湖区","sourceAddress":"武汉市东西湖区陈家冲东村119号","labels":{"setting":"景区后院有林下露营区和可休闲垂钓的鱼塘。","family":"景区有沙池、草坪和亲子游玩设施。","parking":"景区外可免费停车。"},"source":{"platform":"media","publisher":"湖北日报","url":"https://news.hubeidaily.net/mobile/c_5466306.html"},"sourceDate":"2026-05-06"},
  {"name":"沿河星空河畔营地钓场","city":"武汉市","waterType":"钓场","poiQuery":"沿河村星空河畔营地","district":"黄陂区","sourceAddress":"武汉市黄陂区姚家集街道沿河村","labels":{"setting":"湖北日报记录了营地沿河布置的钓台和一旁的露营设施。"},"source":{"platform":"public","publisher":"湖北日报报道","url":"https://nyncj.wuhan.gov.cn/xwzx_25/whsn/202607/t20260706_2817146.html"},"sourceDate":"2026-07-06"},
  {"name":"随心所鱼钓场","city":"武汉市","district":"汉阳区","sourceAddress":"武汉市汉阳区龙阳湖路童话生态园","labels":{"parking":"钓场资料注明垂钓可免费停车。","family":"钓场所在园区旁有儿童乐园和运动场。"},"waterType":"钓场","source":{"platform":"media","publisher":"钓鱼之家","url":"https://m.diaoyu.com/diaochang/wuhan/243005.html"},"sourceDate":""},
  {"name":"龙泉山龙天钓场","city":"武汉市","district":"江夏区","sourceAddress":"武汉市江夏区龙泉山乐天垂钓中心","labels":{},"poiQuery":"乐天垂钓中心","waterType":"钓场","source":{"platform":"media","publisher":"钓鱼之家","url":"https://m.diaoyu.com/diaochang/wuhan/241174.html"},"sourceDate":""},
  {"name":"胖胖农庄钓场","city":"武汉市","district":"新洲区","sourceAddress":"武汉市新洲区旧街街三河口村东","labels":{},"poiQuery":"胖胖农庄","waterType":"钓场","source":{"platform":"media","publisher":"钓鱼之家","url":"https://m.diaoyu.com/diaochang/wuhan/207590.html"},"sourceDate":""},
  {"name":"小亮钓场","city":"武汉市","district":"蔡甸区","sourceAddress":"武汉市蔡甸区大集街道天鹅湖大道与嵩阳大道交汇处西侧","labels":{"setting":"钓场资料介绍其鱼塘约30亩，周边环境适合休闲垂钓。"},"waterType":"钓场","source":{"platform":"media","publisher":"钓鱼之家","url":"https://m.diaoyu.com/diaochang/wuhan/207106.html"},"sourceDate":""},
  {"name":"黑麦草垂钓","city":"武汉市","district":"东西湖区","sourceAddress":"武汉市东西湖区柏泉街道柏宋路龙王台遗址公交站附近","labels":{"parking":"钓场资料列有可停约50辆小车的停车场。"},"waterType":"钓场","source":{"platform":"media","publisher":"钓鱼之家","url":"https://m.diaoyu.com/diaochang/wuhan/206896.html"},"sourceDate":""},
  {"name":"鲁湖路亚练杆基地","city":"武汉市","district":"江夏区","sourceAddress":"武汉市江夏区雷岭村武汉联投鲁湖酒店","labels":{"setting":"钓场资料介绍基地靠近鲁湖酒店，水面约60亩。"},"poiQuery":"鲁湖路亚练杆基地","waterType":"钓场","source":{"platform":"media","publisher":"钓鱼之家","url":"https://m.diaoyu.com/diaochang/wuhan/237217.html"},"sourceDate":""},
  {"name":"星光生态农业园垂钓基地","city":"武汉市","district":"蔡甸区","sourceAddress":"武汉市蔡甸区新集村土桐线","labels":{"setting":"钓场资料记录了园内的垂钓水面和餐饮配套。"},"poiQuery":"星光生态农业园","waterType":"钓场","source":{"platform":"media","publisher":"钓鱼之家","url":"https://m.diaoyu.com/diaochang/wuhan/242467.html"},"sourceDate":""},
  {"name":"张之洞遛鱼城市钓场","city":"武汉市","district":"汉阳区","waterType":"钓场","poiQuery":"汉阳张之洞遛鱼城市钓场","sourceAddress":"武汉市汉阳区琴台大道","source":{"platform":"douyin","url":"https://www.douyin.com/video/7709583031078856787"},"sourceDate":"2026-11-19","labels":{},"evidence":"6小时练杆票"},
  {"name":"江城鲢鳙基地","city":"武汉市","waterType":"钓场","sourceAddress":"武汉经开区硃山渔乐体育公园","source":{"platform":"toutiao","url":"https://www.toutiao.com/article/7651116613881659945/"},"relatedSources":[{"platform":"public","publisher":"武汉经开区","url":"https://www.whkfq.gov.cn/xwzx/yw/kfqyw/qnxw/202602/t20260204_2724475.html"},{"platform":"media","publisher":"湖北日报","url":"https://news.hubeidaily.net/pc/c_5122245.html"}],"sourceDate":"2026-06-14","labels":{},"evidence":"钓了11条花白鲢"},
  {"name":"凤凰镇路亚小镇","city":"武汉市","district":"新洲区","waterType":"钓场","poiQuery":"武汉市新洲区凤凰镇路亚小镇","sourceAddress":"武汉市新洲区凤凰镇","source":{"platform":"public","publisher":"新洲区人民政府","url":"https://www.whxinzhou.gov.cn/xwzx_29/mtxz/202509/t20250916_2648464.shtml"},"relatedSources":[{"platform":"bilibili","url":"https://www.bilibili.com/video/BV1R97rzuE6d/"}],"sourceDate":"2025-09-16","labels":{},"evidence":"从武昌专门来钓鱼"},
  {"name":"古潭田园农庄","city":"武汉市","district":"黄陂区","waterType":"钓场","sourceAddress":"武汉市黄陂区祁家湾街道王棚村","source":{"platform":"public","publisher":"武汉市农业农村局","url":"https://nyncj.wuhan.gov.cn/xwzx_25/whsn/202609/t20260904_2843424.html"},"sourceDate":"2026-09-04","labels":{},"evidence":"可以独坐垂钓"},
  {"name":"丹枫白露民宿垂钓区","city":"武汉市","district":"新洲区","waterType":"钓场","poiQuery":"靠山小镇·丹枫白露民宿","sourceAddress":"武汉市长江新区仓埠街道项山村靠山小镇","source":{"platform":"public","publisher":"武汉市农业农村局","url":"https://nyncj.wuhan.gov.cn/xwzx_25/whsn/202609/t20260924_2853725.html"},"sourceDate":"2026-09-24","labels":{"setting":"满目皆是治愈田园风光。"},"evidence":"民宿内垂钓区"},
  {"name":"金龙水寨生态乐园垂钓区","city":"武汉市","district":"蔡甸区","waterType":"钓场","poiQuery":"金龙水寨生态乐园","sourceAddress":"武汉市蔡甸区索河街道金龙村","source":{"platform":"public","publisher":"武汉市农业农村局","url":"https://nyncj.wuhan.gov.cn/xwzx_25/whsn/202609/t20260920_2850463.html"},"sourceDate":"2026-09-20","labels":{"family":"亲子戏水——森林木屋、水上闯关、丛林探险项目丰富"},"evidence":"湖畔水上垂钓"},
  {"name":"仓埠山庄生态钓场","city":"武汉市","district":"新洲区","waterType":"钓场","sourceAddress":"武汉市长江新区仓埠街道丰乐村","source":{"platform":"media","publisher":"长江日报","url":"https://cjrb.cjn.cn/html/2025-08/05/content_151733_2478919.htm"},"relatedSources":[{"platform":"public","publisher":"武汉长江新区","url":"https://www.whcjxq.gov.cn/xqdt/zxyw/202404/t20240410_2386611.shtml"}],"sourceDate":"2025-08-05","labels":{"setting":"优越的周边环境"},"evidence":"良好的垂钓体验"}
]
$catalog$::jsonb) as leads(card);

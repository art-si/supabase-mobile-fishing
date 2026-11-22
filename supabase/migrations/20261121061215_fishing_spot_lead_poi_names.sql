update public.fishing_spot_leads as lead
set card = lead.card || jsonb_build_object('poiQuery', matched.poi_name)
from (values
  ('巨龙湖生态园垂钓区', '武汉市巨龙湖生态园'),
  ('沿河星空河畔营地钓场', '沿河星空河畔营地'),
  ('龙泉山龙天钓场', '龙泉山乐天垂钓中心')
) as matched(spot_name, poi_name)
where lead.city = '武汉市' and lead.name = matched.spot_name;

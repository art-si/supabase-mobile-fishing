import type { SpotLead } from '../../supabase/functions/_shared/discovery-contract'

function directorySpot(id: number, name: string, district: string, address: string, labels: SpotLead['labels'], poiQuery?: string): SpotLead {
  return {
    name, city: '武汉市', district, sourceAddress: '武汉市' + district + address, labels, poiQuery,
    waterType: '钓场',
    source: { platform: 'media', publisher: '钓鱼之家', url: 'https://m.diaoyu.com/diaochang/wuhan/' + id + '.html' },
    sourceDate: ''
  }
}

// Published local coverage available before the live search provider is configured.
export const publicSpotLeads: SpotLead[] = [
  {
    name: '杉野灵溪休闲垂钓区',
    city: '武汉市',
    waterType: '钓场',
    poiQuery: '杉野灵溪',
    district: '东西湖区',
    sourceAddress: '武汉市东西湖区慈惠街道乡伴慈惠景区',
    labels: {
      setting: '园区有浅滩、休憩座椅和休闲垂钓区。',
      family: '亲子营地设浅滩戏水和萌宠互动区。'
    },
    source: {
      platform: 'public', publisher: '武汉生态环境局',
      url: 'https://hbj.wuhan.gov.cn/hjxw/202610/t20261008_2857123.html'
    },
    relatedSources: [
      { platform: 'douyin', url: 'https://www.douyin.com/video/7682647620952061803' },
      { platform: 'toutiao', url: 'https://www.toutiao.com/article/7555732732966470154/' }
    ],
    sourceDate: '2026-10-03'
  },
  {
    name: '仙耕道谷垂钓区',
    city: '武汉市',
    waterType: '钓场',
    poiQuery: '仙耕道谷',
    district: '黄陂区',
    sourceAddress: '武汉市黄陂区蔡店街张河村',
    labels: { setting: '垂钓区在张河村的田园综合体，附近有山林与溪流。' },
    source: {
      platform: 'public', publisher: '武汉农业农村局',
      url: 'https://nyncj.wuhan.gov.cn/xwzx_25/whsn/202609/t20260916_2848922.html'
    },
    sourceDate: '2026-09-16'
  },
  {
    name: '巨龙湖生态园垂钓区',
    city: '武汉市',
    waterType: '钓场',
    poiQuery: '武汉市巨龙湖生态园',
    district: '东西湖区',
    sourceAddress: '武汉市东西湖区遮湖岗258号',
    labels: {
      setting: '湖北日报记录了园内的湖畔景观和垂钓活动。',
      parking: '园区内提供免费停车。',
      family: '园区可露营、钓鱼和钓虾，报道将其列为家庭出游去处。'
    },
    source: {
      platform: 'media', publisher: '湖北日报',
      url: 'https://news.hubeidaily.net/mobile/c_5466306.html'
    },
    sourceDate: '2026-05-06'
  },
  {
    name: '小奓湖休闲垂钓基地',
    city: '武汉市',
    waterType: '钓场',
    district: '黄陂区',
    sourceAddress: '武汉市黄陂区武湖街道中心路五七分场附近',
    labels: { setting: '钓场资料介绍场地约25亩，并提到周边环境优美。' },
    source: {
      platform: 'media', publisher: '钓鱼之家',
      url: 'https://m.diaoyu.com/diaochang/wuhan/200577.html'
    },
    sourceDate: ''
  },
  {
    name: '空港湿地花田垂钓区',
    city: '武汉市',
    waterType: '钓场',
    poiQuery: '武汉农业集团空港湿地花田',
    district: '东西湖区',
    sourceAddress: '武汉市东西湖区柏泉街道银柏东路',
    labels: {
      parking: '园区入口提供免费停车。',
      family: '园内安排了萌宠互动和户外运动，垂钓需要自带钓具。'
    },
    source: { platform: 'media', publisher: '湖北日报', url: 'https://news.hubeidaily.net/mobile/c_5466306.html' },
    sourceDate: '2026-05-06'
  },
  {
    name: '枕山栖谷垂钓区',
    city: '武汉市',
    waterType: '钓场',
    poiQuery: '武汉枕山栖谷',
    district: '东西湖区',
    sourceAddress: '武汉市东西湖区陈家冲东村119号',
    labels: {
      setting: '景区后院有林下露营区和可休闲垂钓的鱼塘。',
      family: '景区有沙池、草坪和亲子游玩设施。',
      parking: '景区外可免费停车。'
    },
    source: { platform: 'media', publisher: '湖北日报', url: 'https://news.hubeidaily.net/mobile/c_5466306.html' },
    sourceDate: '2026-05-06'
  },
  {
    name: '沿河星空河畔营地钓场',
    city: '武汉市',
    waterType: '钓场',
    poiQuery: '沿河星空河畔营地',
    district: '黄陂区',
    sourceAddress: '武汉市黄陂区姚家集街道沿河村',
    labels: { setting: '湖北日报记录了营地沿河布置的钓台和一旁的露营设施。' },
    source: {
      platform: 'public', publisher: '湖北日报报道',
      url: 'https://nyncj.wuhan.gov.cn/xwzx_25/whsn/202607/t20260706_2817146.html'
    },
    sourceDate: '2026-07-06'
  },
  directorySpot(243005, '随心所鱼钓场', '汉阳区', '龙阳湖路童话生态园', {
    parking: '钓场资料注明垂钓可免费停车。',
    family: '钓场所在园区旁有儿童乐园和运动场。'
  }),
  directorySpot(241174, '龙泉山龙天钓场', '江夏区', '龙泉山乐天垂钓中心', {},
    '龙泉山乐天垂钓中心'),
  directorySpot(207590, '胖胖农庄钓场', '新洲区', '旧街街三河口村东', {},
    '胖胖农庄'),
  directorySpot(207106, '小亮钓场', '蔡甸区', '大集街道天鹅湖大道与嵩阳大道交汇处西侧', {
    setting: '钓场资料介绍其鱼塘约30亩，周边环境适合休闲垂钓。'
  }),
  directorySpot(206896, '黑麦草垂钓', '东西湖区', '柏泉街道柏宋路龙王台遗址公交站附近', {
    parking: '钓场资料列有可停约50辆小车的停车场。'
  }),
  directorySpot(237217, '鲁湖路亚练杆基地', '江夏区', '雷岭村武汉联投鲁湖酒店', {
    setting: '钓场资料介绍基地靠近鲁湖酒店，水面约60亩。'
  }, '鲁湖路亚练杆基地'),
  directorySpot(242467, '星光生态农业园垂钓基地', '蔡甸区', '新集村土桐线', {
    setting: '钓场资料记录了园内的垂钓水面和餐饮配套。'
  }, '星光生态农业园')
]

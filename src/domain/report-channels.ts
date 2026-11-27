/** Public-source directory, not an API/recipient authorization registry. No automatic forwarding. */
export interface ReportChannel {
  id: string
  name: string
  province?: string
  provinces?: readonly string[]
  city?: string
  /** Explicit, verified names only; never fuzzy-match different jurisdictions. */
  cityAliases?: readonly string[]
  district?: string
  /** Unspecified entries accept fishery reports. */
  topic?: 'water' | 'general'
  issueLabel?: string
  kind: 'phone' | 'wechat' | 'mini-program' | 'website'
  /** Optional only when the official source publishes a verifiable direct entry. Never infer an AppId. */
  miniProgram?: { appId: string; path?: string; source: string }
  /** Only an officially published reporting mailbox, never a staff/consultation mailbox. */
  email?: string
  phoneHours?: string
  additionalPhone?: { number: string; label: string }
  scopeNote?: string
  /** Exact agency POI name, not the display label of a hotline. */
  officeName?: string
  address?: string
  value: string
  instructions: string
  source: string
  checked: string
  standingNational?: boolean
  /** Annual/special-action notices stop being actionable without renewed verification. */
  validUntil?: string
}
const huangshi = 'https://nyj.huangshi.gov.cn/nyzx/xzgw/202604/t20260423_1323191.html'
const checked = '2026-11-19'
const heilongjiang = 'https://www.hlj.gov.cn/hlj/c116012qem/202605/c00_31945151.shtml'
const hunan = 'https://agri.hunan.gov.cn/agri/ztzl/jbdh/agrtsjb/202110/t20211014_22497962.html'
// The official page is maintained in 2026; the notice itself is dated 2024-03-13.
// These accept agricultural case reports, not only fishery reports. Keep the actual agency names.
const hunanCities = [
  ['changsha', '长沙市', '长沙市农业综合执法局', '0731-89728970'],
  ['zhuzhou', '株洲市', '株洲市农业综合执法支队', '0731-28682303'],
  ['xiangtan', '湘潭市', '湘潭市农业综合执法支队', '0731-55855089'],
  ['hengyang', '衡阳市', '衡阳市农业综合执法支队', '0734-2669602'],
  ['shaoyang', '邵阳市', '邵阳市农业综合执法支队', '0739-8999807'],
  ['yueyang', '岳阳市', '岳阳市农业综合执法支队', '0730-8215086'],
  ['changde', '常德市', '常德市农业综合执法支队', '0736-2912555'],
  ['zhangjiajie', '张家界市', '张家界市农业农村局', '0744-8281352'],
  ['yiyang', '益阳市', '益阳市农业综合执法支队', '0737-4202110'],
  ['chenzhou', '郴州市', '郴州市农业综合执法支队', '0735-2876965'],
  ['yongzhou', '永州市', '永州市农业综合执法支队', '0746-8369001'],
  ['huaihua', '怀化市', '怀化市农业综合执法支队', '0745-2712816'],
  ['loudi', '娄底市', '娄底市农业综合执法支队', '0738-8328508'],
  ['xiangxi', '湘西土家族苗族自治州', '湘西州农业综合执法局', '0743-2128029']
] as const
// Transcribed from the province's 2026 notice, not a map POI/contact scraper.
// Harbin's listed 12345 is already available through the nationwide fallback.
const heilongjiangCities = [
  ['qiqihar', '齐齐哈尔市', '0452-2790722'],
  ['mudanjiang', '牡丹江市', '0453-6235110'],
  ['jiamusi', '佳木斯市', '0454-8420256'],
  ['daqing', '大庆市', '0459-6396066'],
  ['jixi', '鸡西市', '0467-2376971'],
  ['shuangyashan', '双鸭山市', '0469-8856997'],
  ['yichun', '伊春市', '0458-6113718'],
  ['qitaihe', '七台河市', '0464-8665180'],
  ['hegang', '鹤岗市', '0468-3330013'],
  ['suihua', '绥化市', '0455-8383050'],
  ['heihe', '黑河市', '0456-8272915'],
  ['daxinganling', '大兴安岭地区', '0457-2133008']
] as const
export const REPORT_CHANNELS: readonly ReportChannel[] = [
  {
    id: 'guilin-lijiang-mini', name: '星检漓江保护数字小卫士', topic: 'general',
    province: '广西壮族自治区', city: '桂林市', kind: 'mini-program', value: '星检漓江保护数字小卫士',
    checked: '2026-11-20',
    instructions: '七星区检察院的漓江生态环境线索入口。用于漓江流域生态保护问题，请在微信核对官方主体及受理范围后提交。',
    source: 'https://www.spp.gov.cn/spp/zdgz/202512/t20251207_713008.shtml'
  },
  {
    id: 'caidian-fishery', name: '蔡甸区农业综合执法大队',
    province: '湖北省', city: '武汉市', district: '蔡甸区',
    officeName: '蔡甸区农业综合执法大队', kind: 'phone', value: '027-84995835', checked: '2026-11-20',
    phoneHours: '白天', additionalPhone: { number: '027-84993165', label: '夜间拨打' },
    instructions: '武汉市农业农村局公布：白天举报电话；夜间可拨027-84993165。受理情况以部门答复为准。',
    source: 'https://nyncj.wuhan.gov.cn/xwzx_25/whsn/202508/t20250829_2640592.html'
  },
  {
    id: 'wuhan-fishery', name: '武汉渔政举报电话',
    province: '湖北省', city: '武汉市', kind: 'phone', value: '027-82892218', checked: '2026-11-20',
    phoneHours: '24小时',
    instructions: '武汉市农业农村局公布的24小时渔政举报电话。请说明具体水域与现场情况。',
    source: 'https://nyncj.wuhan.gov.cn/xwzx_25/whsn/202508/t20250829_2640592.html'
  },
  {
    id: 'huichang-agriculture', name: '会昌县农业农村局', officeName: '会昌县农业农村局',
    province: '江西省', city: '赣州市', district: '会昌县', kind: 'phone', value: '0797-5622137',
    email: 'hcxnyzfd@126.com', address: '会昌县文武坝镇岚山路6号', checked: '2026-11-20',
    instructions: '县政府常年公开的农业违法举报渠道，包括非法捕捞。邮箱、电话与通信地址均来自同一官方办法，请核对受理范围。',
    source: 'https://www.huichang.gov.cn/hcxxxgk/hc874566/202106/307f5a6733df4f17a2a8bd327ffcad08.shtml'
  },
  {
    id: 'changjiang-police', name: '公安部“长江大保护”举报中心',
    provinces: ['上海市','江苏省','浙江省','安徽省','江西省','湖北省','湖南省','重庆市','四川省','贵州省','云南省'],
    kind: 'phone', value: '027-83922110', email: 'changjiangjinbu@163.com', checked: '2026-11-20',
    scopeNote: '仅限长江流域非法捕捞等犯罪线索',
    instructions: '仅受理长江流域非法捕捞、非法采砂等犯罪线索，24小时热线。同省其他流域请联系当地部门。',
    source: 'https://cjjjd.ndrc.gov.cn/gongzuodongtai/bumendongtai/202309/t20230901_1360306.htm'
  },
  {
    id: 'guangzhou-baiyun-fishery', name: '广州市白云区农业农村局', officeName: '广州市白云区农业农村局',
    province: '广东省', city: '广州市', district: '白云区', kind: 'phone', value: '020-31238005',
    address: '广州市广园中路238号', checked: '2026-11-20',
    instructions: '区农业农村局2026年公布的打击非法捕捞举报电话。未公布专门的涉渔举报邮箱。',
    source: 'https://www.by.gov.cn/gzbyny/gkmlpt/content/10/10692/post_10692535.html'
  },
  {
    id: 'shanghai-agriculture-form', name: '上海市农业农村委员会行政执法举报信箱',
    province: '上海市', kind: 'website', value: 'https://nyncw.sh.gov.cn/jb/index_zf.html',
    checked: '2026-11-21', source: 'https://nyncw.sh.gov.cn/jb/index_zf.html',
    instructions: '在官网填写上海事发区域和涉嫌违法事实，可附 JPG、PNG 图片或 PDF。'
  },
  {
    id: 'national-fishery', standingNational: true,
    name: '中国渔政举报受理平台',
    kind: 'phone',
    value: '010-59191110',
    checked,
    instructions:
      '全国公共举报渠道。说明事发省市、具体水域及现场情况；接通和受理结果以官方答复为准。',
    source: 'https://www.agri.cn/zx/hxgg/202605/t20260506_8833435.htm'
  },
  {
    id: 'national-wechat', standingNational: true,
    name: '中国渔政微信公众号',
    kind: 'wechat',
    value: '中国渔政',
    checked,
    instructions:
      '在微信搜索并核对官方认证主体，再按公众号提供的举报入口填写。照片需在官方渠道另行上传。',
    source: 'https://www.suzhou.gov.cn/szsrmzf/bmwj/202412/6c9adeb3cee443e2808f538ab61b654a.shtml'
  },
  {
    id: 'local-12345', topic: 'general', standingNational: true,
    name: '事发地12345政务服务便民热线',
    kind: 'phone',
    value: '12345',
    checked,
    instructions:
      '非紧急投诉举报可咨询转办。直接拨打通常接通拨号所在地热线；异地举报请先确认事发城市的拨打方式，不会按所选位置自动转接。',
    source: 'https://www.mee.gov.cn/zcwj/gwywj/202205/t20220516_982293.shtml'
  },
  {
    id: 'huangshi-fishery',
    name: '黄石市涉渔举报',
    province: '湖北省',
    city: '黄石',
    kind: 'phone',
    value: '0714-6288392',
    phoneHours: '工作日 8:30–17:30',
    checked,
    instructions: '官方公告：工作日8:30–17:30。其他时段请查看来源中的24小时渠道。',
    source: huangshi
  },
  {
    id: 'daye-fishery',
    name: '大冶市涉渔举报',
    province: '湖北省',
    city: '黄石',
    district: '大冶',
    kind: 'phone',
    value: '0714-8762281',
    phoneHours: '工作日 8:30–17:30',
    checked,
    instructions: '官方公告：工作日8:30–17:30。仅匹配大冶市辖区。',
    source: huangshi
  },
  {
    id: 'yangxin-fishery',
    name: '阳新县涉渔举报',
    province: '湖北省',
    city: '黄石',
    district: '阳新',
    kind: 'phone',
    value: '0714-3503111',
    phoneHours: '24小时',
    checked,
    instructions: '官方公告：24小时。仅匹配阳新县辖区。',
    source: huangshi
  },
  {
    id: 'jiangsu-wechat',
    name: '江苏长江禁渔随手拍',
    province: '江苏省',
    kind: 'mini-program',
    value: '江苏长江禁渔随手拍',
    checked: '2026-11-20',
    instructions:
      '用于江苏长江禁渔线索。在微信搜索并核对官方小程序及事发水域的受理范围，再按要求提交图片、视频和文字。',
    source: 'https://www.suzhou.gov.cn/szsrmzf/bmwj/202412/6c9adeb3cee443e2808f538ab61b654a.shtml'
  },
  {
    id: 'heilongjiang-fishery',
    name: '黑龙江省禁渔举报',
    province: '黑龙江省',
    kind: 'phone',
    value: '0451-84681587',
    checked,
    validUntil: '2027-01-01T00:00:00+08:00',
    instructions:
      '省农业农村厅2026年禁渔期通告所列省级渠道。请说明事发水域，适用范围以官方答复为准。',
    source: heilongjiang
  },
  ...heilongjiangCities.map(
    ([id, city, value]): ReportChannel => ({
      id: `heilongjiang-${id}`,
      name: `${city}禁渔举报`,
      province: '黑龙江省',
      city,
      kind: 'phone',
      value,
      checked,
      validUntil: '2027-01-01T00:00:00+08:00',
      instructions:
        '省农业农村厅2026年禁渔期通告所列属地渠道；未注明接听时段。请先核对具体水域是否属其管辖。',
      source: heilongjiang
    })
  ),
  ...hunanCities.map(
    ([id, city, name, value]): ReportChannel => ({
      id: `hunan-${id}-agriculture`,
      name,
      officeName: name,
      province: '湖南省',
      city,
      ...(id === 'xiangxi' ? { cityAliases: ['湘西州', '湘西自治州'] } : {}),
      kind: 'phone',
      value,
      checked: '2026-11-20',
      instructions:
        '省农业农村厅公布的属地农业违法案件线索举报电话。请说明疑似非法捕捞的水域和情况，具体受理范围以部门答复为准；未注明接听时段。',
      source: hunan
    })
  ),
  {
    id: 'yudu-fishery',
    name: '于都县农业综合行政执法大队',
    officeName: '于都县农业综合行政执法大队',
    province: '江西省',
    city: '赣州',
    district: '于都',
    kind: 'phone',
    value: '0797-6223923',
    phoneHours: '工作日',
    checked,
    validUntil: '2027-01-01T00:00:00+08:00',
    instructions:
      '2026年专项行动公告列出的工作日举报电话；适用于于都县天然水域，包括江河、湖泊和水库。',
    source:
      'https://www.yudu.gov.cn/ydxxxgk/c145193cpg/202602/f5358363a4b7446b91af5c929fffbc94.shtml'
  },
  {
    id: 'xuanzhou-fishery',
    name: '宣州区渔业违法举报',
    province: '安徽省',
    city: '宣城',
    district: '宣州',
    kind: 'phone',
    value: '0563-3023434',
    checked,
    instructions: '宣州区农业农村局2026年7月公布的举报电话；仅匹配宣州区，未注明接听时段。',
    source: 'https://www.xuanzhou.gov.cn/Jczwgk/show/3799962.html'
  },
  {
    id: 'langxi-fishery',
    name: '郎溪县农业农村局',
    officeName: '郎溪县农业农村局',
    province: '安徽省',
    city: '宣城',
    district: '郎溪',
    kind: 'phone',
    value: '0563-7026787',
    checked: '2026-11-20',
    instructions:
      '县农业农村局2026年5月通告所列非法捕捞举报电话，适用于郎溪县天然水域；未注明接听时段。',
    source: 'https://www.ahlx.gov.cn/Jczwgk/show/3722392.html'
  },
  {
    id: 'yunfu-fishery',
    name: '云浮市涉渔违法举报',
    province: '广东省',
    city: '云浮',
    kind: 'phone',
    value: '0766-8923252',
    phoneHours: '工作日',
    checked,
    instructions:
      '市农业农村局2026年公告：工作日可拨打；其他时段公告建议0766-12345。如需联系具体水库管理方，请另行核对联系方式。',
    source: 'https://www.yunfu.gov.cn/nyncj/zwgk/gggs/content/post_2005247.html'
  },
  {
    id: 'water-supervision', name: '水利部12314监督举报平台', issueLabel: '河湖侵占 · 水利部 12314', topic: 'water', standingNational: true,
    kind: 'website', value: 'https://supe.mwr.gov.cn/#/', checked: '2026-11-21',
    additionalPhone: { number: '12314', label: '拨打热线' }, scopeNote: '河湖侵占、岸线及水资源管理问题',
    instructions: '河湖侵占、岸线和水资源管理等水利问题可在官网填写地点、情况并提交附件，也可拨打12314。',
    source: 'https://slj.xuancheng.gov.cn/News/show/1475925.html'
  },
  {
    id: 'environment-report', name: '全国生态环境投诉举报平台', issueLabel: '水体污染 · 生态环境部', topic: 'water', standingNational: true,
    kind: 'website', value: 'https://jubao.mee.gov.cn/', checked: '2026-11-21',
    scopeNote: '违法排污、水体污染等环境问题',
    instructions: '违法排污、水体污染等可在生态环境部官网举报并查询办理进度。',
    source: 'https://www.mee.gov.cn/ywgz/hjwrjb/'
  },
  {
    id: 'national-procuratorate-web', name: '12309中国检察网', topic: 'general', kind: 'website', value: 'https://www.12309.gov.cn/',
    checked: '2026-11-20',
    instructions: '生态环境和资源保护等公益损害线索，可在官网查找“公益诉讼线索”入口并按要求提交。普通涉渔问题优先联系当地渔政，紧急情况请报警。',
    source: 'https://www.spp.gov.cn/spp/zdgz/201909/t20190917_431888.shtml'
  }
]
const normalize = (value: string) => value.trim().replace(/(地区|市|区|县)$/, '')
/** Prefer verified local accepting agencies; national entries are a fallback, not peers. */
export function preferredReportChannels(channels: readonly ReportChannel[]) {
  const local = channels.filter(c => c.province && !c.provinces)
  if (local.length) return local
  // A 12345 transfer line is not a specialist accepting agency. Keep national
  // issue-specific channels available when that is the only local contact.
  return [...channels]
}
// A county name entered in the city field must not resolve to a different, broader jurisdiction.
const normalizeCity = (value: string) => value.trim().replace(/(地区|市)$/, '')
export const reportChannelSpecificity = (c: ReportChannel) =>
  c.district ? 5 : c.city ? (c.id === 'local-12345' ? 2 : 4) : c.province ? 3 : c.provinces ? 1 : 0
export function matchingReportChannels(
  province: string,
  city = '',
  district = '',
  now = Date.now(),
  options: { category?: string; areaCode?: string } = {}
) {
  // Do not imply mainland agencies have jurisdiction over these separately administered channels.
  if (['香港特别行政区', '澳门特别行政区', '台湾省'].includes(province)) return []
  return REPORT_CHANNELS.filter(
    (c) =>
      now >= Date.parse(c.checked) &&
      (c.standingNational || now - Date.parse(c.checked) < 180 * 86400000) &&
      (!c.validUntil || now < Date.parse(c.validUntil)) &&
      (!options.category || c.topic === 'general' || (options.category === 'other' ? c.topic === 'water' : c.topic !== 'water')) &&
      (!c.province || c.province === province) &&
      (!c.provinces || c.provinces.includes(province)) &&
      (!c.city ||
        [c.city, ...(c.cityAliases || [])].some(
          (name) => normalizeCity(name) === normalizeCity(city)
        )) &&
      (!c.district || normalize(c.district) === normalize(district))
  ).map(c => {
    // Use only the telephone area code returned for this water coordinate. An adcode is not a dialling code.
    if (c.id !== 'local-12345' || !province || !city || !options.areaCode || !/^0[1-9]\d{1,2}$/.test(options.areaCode)) return c
    return { ...c, city, name: city + '12345政务服务便民热线', value: options.areaCode + '-12345',
      instructions: '接通后说明事发区县、水域和问题，请热线转交当地主管部门。' }
  }).sort((a, b) => reportChannelSpecificity(b) - reportChannelSpecificity(a) ||
    (options.category === 'other' ? Number(b.topic === 'water') - Number(a.topic === 'water') : 0))
}

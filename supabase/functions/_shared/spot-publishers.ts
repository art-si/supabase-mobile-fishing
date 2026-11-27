/** Publisher domains only. A supported domain is not a claim of API/partner authorization. */
export const spotPublishers = [
  ['news.cn', '新华网'], ['people.com.cn', '人民网'], ['chinanews.com', '中国新闻网'],
  ['chinanews.com.cn', '中国新闻网'], ['cctv.com', '央视网'], ['cnr.cn', '央广网'],
  ['thepaper.cn', '澎湃新闻'], ['gmw.cn', '光明网'], ['youth.cn', '中国青年网'],
  ['hubeidaily.net', '湖北日报'], ['cnhubei.com', '荆楚网'], ['ctdsb.net', '极目新闻'],
  ['dawuhanapp.com', '长江日报'], ['cjn.cn', '长江网'],
  ['scol.com.cn', '四川在线'], ['sichuan.scol.com.cn', '四川在线'], ['cbgc.scol.com.cn', '川观新闻'],
  ['cqnews.net', '华龙网'], ['cqcb.com', '上游新闻'], ['zjol.com.cn', '浙江在线'],
  ['tidenews.com.cn', '潮新闻'], ['cnnb.com.cn', '宁波日报'], ['jschina.com.cn', '中国江苏网'],
  ['jfdaily.com', '上观新闻'], ['shobserver.com', '上观新闻'], ['xinmin.cn', '新民晚报'],
  ['dayoo.com', '广州日报'], ['southcn.com', '南方网'], ['nfnews.com', '南方+'],
  ['rednet.cn', '红网'], ['hnrb.voc.com.cn', '湖南日报'], ['voc.com.cn', '华声在线'],
  ['dzwww.com', '大众网'], ['iqilu.com', '齐鲁网'], ['whnews.cn', '威海新闻网'],
  ['fjsen.com', '东南网'], ['jxnews.com.cn', '大江网'], ['hebnews.cn', '河北新闻网'],
  ['hebei.com.cn', '长城网'], ['dbw.cn', '东北网'], ['gywb.cn', '贵阳网'],
  ['gog.cn', '多彩贵州网'], ['yunnan.cn', '云南网'], ['gxnews.com.cn', '广西新闻网'],
  ['diaoyu.com', '钓鱼之家'], ['diaoyur.com', '钓鱼人'], ['haodiaoyu.com', '好钓鱼'],
  ['cbg.cn', '重庆广电'], ['bandao.cn', '半岛新闻'], ['qingdaonews.com', '青岛新闻网'],
  ['sina.com.cn', '新浪新闻'], ['sohu.com', '搜狐'], ['163.com', '网易'], ['qq.com', '腾讯新闻'], ['ifeng.com', '凤凰网']
] as const

export const spotSyndicationFeeds = [
  'https://www.chinanews.com/rss/sports.xml',
  'https://www.chinanews.com/rss/society.xml',
  'https://www.chinanews.com/rss/finance.xml',
  'https://www.chinanews.com/rss/china.xml'
] as const

export function publisherSource(value: string): { platform: 'media'; url: string; publisher: string } | null {
  if (value.length > 500) return null
  try {
    const url = new URL(value)
    if (['mp.weixin.qq.com', 'channels.weixin.qq.com'].includes(url.hostname)) return null
    if (url.protocol !== 'https:' || url.username || url.password || url.port ||
        (!/\d{3,}/.test(url.pathname) && !(/(?:^|\.)163\.com$/.test(url.hostname) && /^\/dy\/article\/[A-Za-z\d]{10,}\.html$/.test(url.pathname)) &&
          !(/(?:^|\.)ifeng\.com$/.test(url.hostname) && /^\/c\/[A-Za-z\d]{10,}$/.test(url.pathname))) || /\.(?:pdf|jpg|png|mp4|zip)$/i.test(url.pathname)) return null
    // Longest match gives a known newspaper/app its own name inside a media group.
    const match = [...spotPublishers].sort((a, b) => b[0].length - a[0].length)
      .find(([host]) => url.hostname === host || url.hostname.endsWith('.' + host))
    if (!match) return null
    if (url.hostname.endsWith('.diaoyu.com') && !/^\/diaochang\/[a-z-]+\/\d+\.html$/.test(url.pathname)) return null
    const publisher = url.hostname === 'cjrb.cjn.cn' ? '长江日报' :
      url.hostname === 'whwb.cjn.cn' ? '武汉晚报' : match[1]
    return { platform: 'media', url: url.origin + url.pathname, publisher }
  } catch { return null }
}

export function publicArticleSource(value: string) {
  const media = publisherSource(value)
  if (media) return media
  try {
    const url = new URL(value)
    if (value.length > 500 || url.protocol !== 'https:' || url.username || url.password || url.port ||
        !url.hostname.endsWith('.gov.cn') || !/^[a-z\d.-]+\.gov\.cn$/.test(url.hostname) ||
        url.pathname.length < 6 || /\.(?:pdf|jpg|png|mp4|zip)$/i.test(url.pathname)) return null
    const publishers: Record<string, string> = {
      'www.whkfq.gov.cn': '武汉经开区', 'nyncj.wuhan.gov.cn': '武汉市农业农村局',
      'hbj.wuhan.gov.cn': '武汉市生态环境局', 'www.whxinzhou.gov.cn': '新洲区人民政府',
      'www.whcjxq.gov.cn': '武汉长江新区', 'nyncw.sh.gov.cn': '上海市农业农村委员会',
      'www.sport.gov.cn': '国家体育总局', 'www.beijing.gov.cn': '北京市人民政府'
    }
    return { platform: 'public' as const, url: url.origin + url.pathname, publisher: publishers[url.hostname] || '地方官方发布' }
  } catch { return null }
}

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse } from '@vue/compiler-sfc'
import { REPORT_CHANNELS } from '../src/domain/report-channels'
import { PRIVACY_SECTIONS, TERMS_SECTIONS } from '../src/domain/legal'

function template(path: string) {
  const source = readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8')
  const result = parse(source)
  assert.deepEqual(result.errors, [])
  assert.ok(result.descriptor.template)
  return result.descriptor.template.content
}

test('fishing and reporting surfaces describe user actions without integration diagnostics', () => {
  const paths = [
    'pages/notifications/index.vue',
    'pages/water-report/ReportChannels.vue',
    'pages/water-report/index.vue',
    'pages/spot/create.vue'
  ]
  for (const path of paths)
    assert.doesNotMatch(
      template(path),
      /Supabase|AppID|\bKey\b|数据库|接入|提交接口|直达接口|未拨号测试|前台自动同步|GCJ-02/,
      path
    )
  for (const channel of REPORT_CHANNELS)
    assert.doesNotMatch(channel.instructions, /AppID|直跳|接口|配置|接入/)
})

test('report offers direct attachment and save actions and keeps storage details in privacy settings', () => {
  const content = template('pages/water-report/index.vue')
  assert.match(content, /添加图片 \/ 视频/)
  assert.match(content, /'上报'/)
  assert.doesNotMatch(content, /role="checkbox"|清除坐标|查看隐私说明/)
  assert.match(readFileSync(new URL('../src/domain/legal.ts',import.meta.url),'utf8'), /中国大陆境外的爱尔兰/)
})

test('copy cleanup preserves reporting and notification limitations', () => {
  assert.match(template('pages/notifications/index.vue'), /这些开关只影响站内通知/)
  const channels = template('pages/water-report/ReportChannels.vue')
  assert.doesNotMatch(channels, /本机体验/)
  assert.match(channels, /打开自己的邮箱确认发送/)
  assert.match(channels, /图片和视频需在邮件中添加/)
  assert.match(channels, /举报联系方式/)
  const channelSource = readFileSync(new URL('../src/pages/water-report/ReportChannels.vue', import.meta.url), 'utf8')
  assert.match(channelSource, /本应用无法确认邮件是否发出/)
  assert.match(channelSource, /材料不会自动传过去/)
  assert.match(channels, /信息核对：/)
  assert.match(channels, /查看官方来源/)
  assert.match(channels, /@click="choose\(channel\)"/)
})

test('settings and legal pages do not expose integration diagnostics or supplier link blocks', () => {
  const settings = readFileSync(new URL('../src/pages/settings/index.vue', import.meta.url), 'utf8')
  assert.doesNotMatch(
    settings,
    /Supabase|接入状态|公开\s*Key|jupuypvmgjpnpntfetqv|wx9f631f76bb1543e0|开发预览版|showServices/
  )
  assert.match(settings, /联系与反馈/)
  const legal = readFileSync(new URL('../src/pages/settings/legal.vue', import.meta.url), 'utf8')
  assert.doesNotMatch(legal, /LEGAL_SERVICE|type=services|服务提供方说明|第三方服务与数据处理/)
  for (const section of [...PRIVACY_SECTIONS, ...TERMS_SECTIONS]) {
    assert.doesNotMatch(section.title, /服务提供方|数据保存与境外处理/)
    assert.doesNotMatch(section.paragraphs.join(''), /Supabase|https?:\/\/|公开\s*Key|AppID|SDK/)
  }
})

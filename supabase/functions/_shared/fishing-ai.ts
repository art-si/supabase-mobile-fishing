import { fishingRpc } from './fishing-edge.ts'

const artAiService = 'https://ckbftoopuyophiebamwy.supabase.co/functions/v1/ai-service'

export type FishingAi = <T>(
  prompt: string,
  input: unknown,
  validate: (data: Record<string, unknown>) => T | null
) => Promise<T | null>

export async function loadFishingAi(callerToken?: string): Promise<FishingAi | null> {
  const token = await fishingRpc<unknown>('fishing_art_ai_client_token', {}, callerToken).catch(() => null)
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return null

  return async (prompt, input, validate) => {
    try {
      const response = await fetch(artAiService, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(36_000),
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + token,
          'X-Art-AI-Client': 'fishing'
        },
        body: JSON.stringify({ prompt, input })
      })
      if (!response.ok) {
        console.info('[fishing-ai] Art request failed', { status: response.status })
        return null
      }
      const result = (await response.json())?.result
      return result && typeof result === 'object' && !Array.isArray(result) ? validate(result) : null
    } catch {
      console.info('[fishing-ai] Art response unavailable')
      return null
    }
  }
}

import { handle } from '@upstash/realtime'
import { realtime } from '@/lib/redis/realtime'

export const GET = handle({ realtime })

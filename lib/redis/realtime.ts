import { Realtime } from '@upstash/realtime'
import { Redis } from '@upstash/redis'
import { z } from 'zod'

const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
})

const schema = {
    generate: {
        event: z.object({
            type: z.enum(['content', 'complete']),
            data: z.object({
                messageId: z.string(),
                sequenceId: z.number(),
                content: z.string().optional(),
                serverSentAt: z.number().optional(),
            })
        })
    }
}

export const realtime = new Realtime({ schema, redis })

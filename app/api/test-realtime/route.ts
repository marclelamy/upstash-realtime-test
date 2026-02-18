import { NextRequest, NextResponse } from 'next/server'
import { realtime } from '@/lib/redis/realtime'

function generatePayload(charCount: number): string {
    const base = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 '
    let result = ''
    for (let i = 0; i < charCount; i++) {
        result += base[i % base.length]
    }
    return result
}

export async function POST(req: NextRequest) {
    const { channelId, count, minSize, maxSize, delayMs } = await req.json()

    const channel = realtime.channel(`generate:${channelId}`)
    const sizes: number[] = []

    for (let i = 0; i < count; i++) {
        sizes.push(Math.floor(Math.random() * (maxSize - minSize + 1)) + minSize)
    }

    for (let i = 0; i < sizes.length; i++) {
        const content = generatePayload(sizes[i])

        channel.emit('generate.event', {
            type: 'content',
            data: {
                messageId: channelId,
                sequenceId: i + 1,
                content,
            }
        })

        await new Promise(r => setTimeout(r, delayMs))
    }

    await channel.emit('generate.event', {
        type: 'complete',
        data: {
            messageId: channelId,
            sequenceId: sizes.length + 1,
        }
    })

    return NextResponse.json({ ok: true, channelId, sizes })
}

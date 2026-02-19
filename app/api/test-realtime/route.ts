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

function percentile(values: number[], p: number): number {
    if (values.length === 0) {
        return 0
    }

    const sorted = [...values].sort((a, b) => a - b)
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1))
    return sorted[index]
}

export async function POST(req: NextRequest) {
    const {
        channelId,
        count,
        minSize,
        maxSize,
        awaitEachEmit = true,
    } = await req.json()

    const channel = realtime.channel(`generate:${channelId}`)
    const sizes: number[] = []
    const emitDurationsMs: number[] = []
    const startedAt = Date.now()
    const shouldAwaitEachEmit = awaitEachEmit !== false

    for (let i = 0; i < count; i++) {
        const content = generatePayload(Math.floor(Math.random() * (maxSize - minSize + 1)) + minSize)
        const emitStartedAt = Date.now()

        console.log('emitting new chunk', ' ', 'chunk count', i)
        const emitPromise = channel.emit('generate.event', {
            type: 'content',
            data: {
                messageId: channelId,
                sequenceId: i + 1,
                content,
                serverSentAt: Date.now(),
            }
        })

        if (shouldAwaitEachEmit) {
            await emitPromise
            const duration = Date.now() - emitStartedAt
            console.log('emitting new chunk', ' ', 'chunk count', i, 'time taken', duration)
            emitDurationsMs.push(duration)
        } else {
            void emitPromise
        }
    }

    await channel.emit('generate.event', {
        type: 'complete',
        data: {
            messageId: channelId,
            sequenceId: count + 1,
            serverSentAt: Date.now(),
        }
    })

    const totalMs = Date.now() - startedAt
    const avgEmitMs = emitDurationsMs.length
        ? emitDurationsMs.reduce((sum, value) => sum + value, 0) / emitDurationsMs.length
        : 0

    return NextResponse.json({
        ok: true,
        channelId,
        sizes,
        expectedCount: count + 1,
        mode: shouldAwaitEachEmit ? 'await' : 'no-await',
        metrics: {
            totalMs,
            avgEmitMs: Number(avgEmitMs.toFixed(2)),
            minEmitMs: emitDurationsMs.length ? Math.min(...emitDurationsMs) : 0,
            maxEmitMs: emitDurationsMs.length ? Math.max(...emitDurationsMs) : 0,
            p95EmitMs: percentile(emitDurationsMs, 0.95),
        },
    })
}

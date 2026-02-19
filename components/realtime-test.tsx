'use client'

import { useState, useRef, useCallback, useMemo } from 'react'
import { useRealtime } from '@/lib/redis/realtime-client'
import { v4 as uuidv4 } from 'uuid'

type ChunkPayload = {
    type: 'content' | 'complete'
    data: {
        messageId: string
        sequenceId: number
        content?: string
        serverSentAt?: number
    }
}

type ReceivedChunk = {
    sequenceId: number
    type: string
    contentLength: number
    arrivalIndex: number
    msSinceLastArrival: number | null
    networkLagMs: number | null
}

type ServerMetrics = {
    totalMs: number
    avgEmitMs: number
    minEmitMs: number
    maxEmitMs: number
    p95EmitMs: number
}

export function RealtimeTest() {
    const [channelId, setChannelId] = useState<string | null>(null)
    const [chunks, setChunks] = useState<ReceivedChunk[]>([])
    const [sending, setSending] = useState(false)
    const [sentSizes, setSentSizes] = useState<number[]>([])
    const [serverMetrics, setServerMetrics] = useState<ServerMetrics | null>(null)
    const arrivalCounter = useRef(0)
    const lastChunkTimestampRef = useRef<number | null>(null)

    const channels = useMemo(() =>
        channelId ? [`generate:${channelId}`] : [],
        [channelId]
    )

    const handleData = useCallback(({ data }: { data: ChunkPayload }) => {
        const sequenceId = data.data?.sequenceId ?? -1
        arrivalCounter.current++
        const now = Date.now()
        const previousArrival = lastChunkTimestampRef.current
        const msSinceLastArrival = previousArrival === null ? null : now - previousArrival
        lastChunkTimestampRef.current = now
        const serverSentAt = data.data?.serverSentAt

        const chunk: ReceivedChunk = {
            sequenceId,
            type: data.type,
            contentLength: typeof data.data?.content === 'string'
                ? data.data.content.length
                : 0,
            arrivalIndex: arrivalCounter.current,
            msSinceLastArrival,
            networkLagMs: typeof serverSentAt === 'number' ? now - serverSentAt : null,
        }

        setChunks((current) => [...current, chunk])
    }, [])

    useRealtime({
        enabled: !!channelId,
        channels,
        events: ['generate.event'],
        onData: handleData,
    })

    const runTest = async () => {
        const id = uuidv4()
        arrivalCounter.current = 0
        lastChunkTimestampRef.current = null
        setChunks([])
        setSentSizes([])
        setServerMetrics(null)
        setChannelId(id)
        setSending(true)

        try {
            const res = await fetch('/api/test-realtime', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    channelId: id,
                    count: 100,
                    minSize: 1,
                    maxSize: 5000,
                    delayMs: 0,
                }),
            })

            if (!res.ok) {
                throw new Error(`Failed to run test: ${res.status}`)
            }

            const result = await res.json()
            setSentSizes(Array.isArray(result.sizes) ? result.sizes : [])
            setServerMetrics(result.metrics ?? null)
        } finally {
            setSending(false)
        }
    }

    const isOrdered = chunks.every((c, i) =>
        i === 0 || c.sequenceId > chunks[i - 1].sequenceId
    )
    const receivedIds = new Set(chunks.map(c => c.sequenceId))
    const expectedCount = sentSizes.length > 0 ? sentSizes.length + 1 : 0
    const missingIds: number[] = []
    for (let i = 1; i <= expectedCount; i++) {
        if (!receivedIds.has(i)) missingIds.push(i)
    }
    const sequenceCounts = new Map<number, number>()
    for (const chunk of chunks) {
        if (chunk.sequenceId <= 0) {
            continue
        }

        sequenceCounts.set(chunk.sequenceId, (sequenceCounts.get(chunk.sequenceId) ?? 0) + 1)
    }
    const duplicateIds = Array.from(sequenceCounts.entries())
        .filter(([, seenCount]) => seenCount > 1)
        .map(([id]) => id)
        .sort((a, b) => a - b)
    const duplicateCount = Array.from(sequenceCounts.values()).reduce((total, seenCount) => {
        if (seenCount <= 1) {
            return total
        }

        return total + (seenCount - 1)
    }, 0)
    const chunksWithLag = chunks.filter((chunk) => chunk.networkLagMs !== null)
    const avgNetworkLagMs = chunksWithLag.length
        ? Math.round(
            chunksWithLag.reduce((sum, chunk) => sum + (chunk.networkLagMs ?? 0), 0) / chunksWithLag.length
        )
        : null

    return (
        <div className="p-8 max-w-5xl mx-auto font-mono text-sm">
            <h1 className="text-2xl font-bold mb-2">Upstash Realtime — Out-of-Order & Dropped Event Repro</h1>
            <p className="text-zinc-500 mb-6">100 events · 1–5000 chars · 0ms delay · sequential await emit</p>

            <button
                onClick={runTest}
                disabled={sending}
                className="mb-8 px-5 py-2.5 rounded-lg bg-black text-white text-sm font-medium disabled:opacity-50 hover:bg-zinc-800 transition-colors"
            >
                {sending ? 'Sending...' : 'Run Test (100 events, 1–5K chars, 0ms delay)'}
            </button>

            {chunks.length > 0 && (
                <div>
                    <div className="mb-4 flex flex-wrap gap-4">
                        <div className="rounded-lg border border-zinc-200 px-4 py-3">
                            <div className="text-xs text-zinc-400 mb-1">Expected</div>
                            <div className="text-xl font-bold">{expectedCount}</div>
                        </div>
                        <div className="rounded-lg border border-zinc-200 px-4 py-3">
                            <div className="text-xs text-zinc-400 mb-1">Received</div>
                            <div className="text-xl font-bold">{chunks.length}</div>
                        </div>
                        <div className="rounded-lg border border-zinc-200 px-4 py-3">
                            <div className="text-xs text-zinc-400 mb-1">Missing</div>
                            <div className={`text-xl font-bold ${missingIds.length > 0 ? 'text-red-500' : 'text-green-600'}`}>
                                {missingIds.length}
                            </div>
                        </div>
                        <div className="rounded-lg border border-zinc-200 px-4 py-3">
                            <div className="text-xs text-zinc-400 mb-1">Order</div>
                            <div className="text-xl font-bold">
                                {isOrdered ? '✅ In order' : '❌ Out of order'}
                            </div>
                        </div>
                        <div className="rounded-lg border border-zinc-200 px-4 py-3">
                            <div className="text-xs text-zinc-400 mb-1">Duplicates</div>
                            <div className={`text-xl font-bold ${duplicateCount > 0 ? 'text-red-500' : 'text-green-600'}`}>
                                {duplicateCount}
                            </div>
                        </div>
                    </div>

                    {missingIds.length > 0 && (
                        <p className="mb-4 text-red-600 text-xs">
                            Missing IDs: {missingIds.join(', ')}
                        </p>
                    )}
                    {duplicateIds.length > 0 && (
                        <p className="mb-4 text-red-600 text-xs">
                            Duplicate IDs: {duplicateIds.join(', ')}
                        </p>
                    )}

                    {serverMetrics && (
                        <div className="mb-4 rounded-lg border border-zinc-200 px-4 py-3 text-xs">
                            <p className="mb-1">
                                Server emit metrics: total {serverMetrics.totalMs.toLocaleString()}ms, avg {serverMetrics.avgEmitMs}ms, p95 {serverMetrics.p95EmitMs}ms, min {serverMetrics.minEmitMs}ms, max {serverMetrics.maxEmitMs}ms
                            </p>
                            <p>
                                Avg client-side lag from serverSentAt: {avgNetworkLagMs === null ? 'N/A' : `${avgNetworkLagMs}ms`}
                            </p>
                        </div>
                    )}

                    <p className="mb-6 text-xs text-zinc-500 break-all">
                        Arrival order: {chunks.map(c => c.sequenceId).join(' → ')}
                    </p>

                    <div className="overflow-x-auto">
                        <table className="w-full text-xs border-collapse">
                            <thead>
                                <tr className="bg-zinc-100">
                                    <th className="text-left p-2 border border-zinc-200">Arrival #</th>
                                    <th className="text-left p-2 border border-zinc-200">Seq ID</th>
                                    <th className="text-left p-2 border border-zinc-200">Type</th>
                                    <th className="text-left p-2 border border-zinc-200">Sent Size</th>
                                    <th className="text-left p-2 border border-zinc-200">Received Size</th>
                                    <th className="text-left p-2 border border-zinc-200">Since Last</th>
                                    <th className="text-left p-2 border border-zinc-200">Lag</th>
                                    <th className="text-left p-2 border border-zinc-200">Match</th>
                                </tr>
                            </thead>
                            <tbody>
                                {chunks.map((c, i) => {
                                    const expected = c.type === 'complete' ? 0 : sentSizes[c.sequenceId - 1]
                                    const match = c.type === 'complete' ? true : c.contentLength === expected
                                    return (
                                        <tr key={i} className={match ? '' : 'bg-red-50'}>
                                            <td className="p-2 border border-zinc-200">{c.arrivalIndex}</td>
                                            <td className="p-2 border border-zinc-200">{c.sequenceId}</td>
                                            <td className="p-2 border border-zinc-200">{c.type}</td>
                                            <td className="p-2 border border-zinc-200">{expected?.toLocaleString() ?? '—'}</td>
                                            <td className="p-2 border border-zinc-200">{c.type === 'complete' ? '—' : c.contentLength.toLocaleString()}</td>
                                            <td className="p-2 border border-zinc-200">{c.msSinceLastArrival === null ? '—' : `${c.msSinceLastArrival}ms`}</td>
                                            <td className="p-2 border border-zinc-200">{c.networkLagMs === null ? '—' : `${c.networkLagMs}ms`}</td>
                                            <td className="p-2 border border-zinc-200">{match ? '✅' : '❌'}</td>
                                        </tr>
                                    )
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    )
}

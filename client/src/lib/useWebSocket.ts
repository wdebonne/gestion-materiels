import { useEffect, useCallback } from 'react'
import { io, Socket } from 'socket.io-client'
import { useAuthStore } from '@/stores/auth.store'

let socket: Socket | null = null

export function useWebSocket() {
  const { token, isAuthenticated } = useAuthStore()

  useEffect(() => {
    if (!isAuthenticated || !token) {
      socket?.disconnect()
      socket = null
      return
    }

    if (socket?.connected) return

    const wsUrl = import.meta.env.VITE_WS_URL || window.location.origin

    socket = io(wsUrl, {
      path: '/ws',
      auth: { token },
      // Polling d'abord, puis passage au WebSocket si le chemin le permet — l'ordre
      // par défaut de Socket.IO. L'ordre inverse ne se rabattait jamais sur le
      // polling (engine.io ne le fait qu'avec `tryAllTransports`) : derrière un
      // reverse proxy qui ne relaie pas `Upgrade`, le client retentait le
      // WebSocket en boucle et le temps réel restait coupé.
      transports: ['polling', 'websocket']
    })

    socket.on('connect', () => {
      console.log('🔌 WebSocket connecté')
    })

    socket.on('disconnect', () => {
      console.log('🔌 WebSocket déconnecté')
    })

    return () => {
      socket?.disconnect()
      socket = null
    }
  }, [isAuthenticated, token])

  const on = useCallback((event: string, handler: (...args: any[]) => void) => {
    socket?.on(event, handler)
    return () => { socket?.off(event, handler) }
  }, [])

  return { socket, on }
}

// Hook pour écouter les alertes temps réel
export function useRealtimeAlerts(onNewAlert?: (alert: any) => void) {
  const { on } = useWebSocket()

  useEffect(() => {
    if (!onNewAlert) return
    const cleanup = on('alert:new', onNewAlert)
    return cleanup
  }, [on, onNewAlert])
}

export function getSocket(): Socket | null {
  return socket
}

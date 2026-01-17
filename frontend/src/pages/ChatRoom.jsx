import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'

const DARK_COLORS = [
  '#1a1a2e', // Dark navy blue
  '#16213e', // Dark blue
  '#0f3460', // Dark indigo
  '#1a237e', // Dark royal blue
  '#2e1a47', // Dark purple
  '#311b92', // Dark violet
  '#4a148c', // Dark magenta
  '#263238', // Dark slate
  '#1b5e20', // Dark green
  '#33691e', // Dark olive
  '#3e2723', // Dark brown
  '#4e342e', // Dark coffee
  '#004d40', // Dark teal
  '#006064', // Dark cyan
  '#1a237e', // Dark blue
  '#304ffe', // Dark blue
  '#6200ea', // Dark purple
  '#d50000', // Dark red
  '#c51162', // Dark pink
  '#33691e'  // Dark green
]

const getAvatarColor = (username) => {
  if (!username) return DARK_COLORS[0]
  
  // Create a hash of the username
  let hash = 0
  for (let i = 0; i < username.length; i++) {
    const char = username.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32-bit integer
  }
  
  // Use hash to select color from array
  const index = Math.abs(hash) % DARK_COLORS.length
  var color = DARK_COLORS[index]
  return color.replace('#', '')
}

function ChatRoom({ user, onLogout }) {
  // Extract username from user object
  // GitHub OAuth provides user_metadata.user_name, fallback to email prefix
  const username = user?.user_metadata?.user_name ||
                   user?.email?.split('@')[0] ||
                   'Anonymous'
  const [messages, setMessages] = useState([])
  const [message, setMessage] = useState('')
  const [socket, setSocket] = useState(null)
  const [isConnected, setIsConnected] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isSpamDetected, setIsSpamDetected] = useState(false)
  const [spamCooldown, setSpamCooldown] = useState(0)
  const messageTimestampsRef = useRef([])
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [oldestTimestamp, setOldestTimestamp] = useState(null)
  const [hasMoreHistory, setHasMoreHistory] = useState(true)
  const messagesEndRef = useRef(null)
  const messagesContainerRef = useRef(null)
  const socketRef = useRef(null)
  const loadingTimeoutRef = useRef(null)
  const fallbackTimeoutRef = useRef(null)
  const previousScrollHeightRef = useRef(null)
  const isPrependingHistoryRef = useRef(false)
  const isProcessingHistoryRef = useRef(false)
  const historyBufferRef = useRef([])
  const historyTimeoutRef = useRef(null)
  const navigate = useNavigate()
  
    // Helper function to process history buffer
  const processHistoryBuffer = () => {
    if (historyBufferRef.current.length === 0) {
      setIsLoadingMore(false)
      isPrependingHistoryRef.current = false
      return
    }
    
    // Set processing flag to prevent scroll-to-bottom during history loading
    isProcessingHistoryRef.current = true
    
    // Sort buffer by timestamp to ensure correct chronological order (oldest first)
    const sortedHistory = historyBufferRef.current.sort((a, b) => a.timestamp - b.timestamp)
    
    // Prepend all history messages at once
    setMessages((prev) => {
      // Filter out duplicates from both buffer and existing messages
      const newHistoryMessages = sortedHistory.filter(newMsg => {
        return !prev.some(
          (existingMsg) => 
            existingMsg.id === newMsg.id ||
            (existingMsg.type === newMsg.type &&
             existingMsg.username === newMsg.username &&
             existingMsg.message === newMsg.message &&
             Math.abs((existingMsg.timestamp || 0) - (newMsg.timestamp || 0)) < 1000)
        )
      })
      
      // Prepend all new history messages at once
      return [...newHistoryMessages, ...prev]
    })
    
    // Clear the buffer
    historyBufferRef.current = []
    
    // Restore scroll position after history batch is complete
    if (previousScrollHeightRef.current !== null) {
      setTimeout(() => {
        const container = messagesContainerRef.current
        if (container && previousScrollHeightRef.current !== null) {
          const newScrollHeight = container.scrollHeight
          const scrollDiff = newScrollHeight - previousScrollHeightRef.current
          container.scrollTop = container.scrollTop + scrollDiff
          previousScrollHeightRef.current = null
        }
      }, 0)
    }
    
    // Clear processing flag after a brief delay to ensure scroll position is restored
    setTimeout(() => {
      isProcessingHistoryRef.current = false
    }, 100)
    
    setIsLoadingMore(false)
    isPrependingHistoryRef.current = false
  }

  useEffect(() => {
    if (socketRef.current) {
      return
    }

    const wsUrl = window.location.protocol === 'https:' ? 'wss://jagc.web.id' : 'ws://localhost:9001'
    
    const ws = new WebSocket(wsUrl)
    socketRef.current = ws

    ws.onopen = () => {
      setIsConnected(true)
      setSocket(ws)
      // Reset history state on new connection
      setHasMoreHistory(true)
      setOldestTimestamp(null)
      // Reset spam detection on new connection
      setIsSpamDetected(false)
      setSpamCooldown(0)
      messageTimestampsRef.current = []
      // Keep loading true until we receive messages
      // The server sends multiple messages on connect (welcome + historical messages)
      // Fallback: if no messages arrive within 3 seconds, hide loading anyway
      fallbackTimeoutRef.current = setTimeout(() => {
        setIsLoading(false)
        if (loadingTimeoutRef.current) {
          clearTimeout(loadingTimeoutRef.current)
          loadingTimeoutRef.current = null
        }
      }, 3000)
    }

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data)
      const now = Date.now()

      // Handle history messages (older messages loaded on scroll up)
      if (data.type === 'history') {
        const messageWithId = {
          ...data,
          type: 'chat', // Convert history type to chat for consistent handling
          id: data.id || `${data.timestamp}-${Math.random()}`,
          timestamp: data.timestamp || now
        }
        
        // Store scroll position before first history message in batch
        if (!isPrependingHistoryRef.current) {
          const container = messagesContainerRef.current
          if (container) {
            previousScrollHeightRef.current = container.scrollHeight
            isPrependingHistoryRef.current = true
            historyBufferRef.current = [] // Reset buffer for new batch
            
            // Clear any existing timeout
            if (historyTimeoutRef.current) {
              clearTimeout(historyTimeoutRef.current)
            }
          }
        }
        
        // Add to buffer instead of immediately prepending
        // This allows us to prepend all messages at once in correct order
        historyBufferRef.current.push(messageWithId)
        
        // Set a timeout to process buffer if history_end doesn't arrive
        // Server sends history_end only when no messages, so we need this fallback
        if (historyTimeoutRef.current) {
          clearTimeout(historyTimeoutRef.current)
        }
        historyTimeoutRef.current = setTimeout(() => {
          processHistoryBuffer()
          historyTimeoutRef.current = null
        }, 500) // Wait 500ms after last history message
        
        return
      }

      // Handle history_end (no more messages to load)
      if (data.type === 'history_end') {
        // Clear timeout since we received history_end
        if (historyTimeoutRef.current) {
          clearTimeout(historyTimeoutRef.current)
          historyTimeoutRef.current = null
        }
        
        // Process any buffered messages first
        if (historyBufferRef.current.length > 0) {
          processHistoryBuffer()
        } else {
          // No messages in buffer means we've reached the end
          setHasMoreHistory(false)
          setIsLoadingMore(false)
          isPrependingHistoryRef.current = false
        }
        return
      }

      // Handle regular messages (chat and system)
      const messageWithId = {
        ...data,
        id: data.id || `${now}-${Math.random()}`,
        timestamp: data.timestamp || now
      }
      setMessages((prev) => {
        const isDuplicate = prev.some(
          (msg) => 
            msg.id === messageWithId.id ||
            (msg.type === messageWithId.type &&
             msg.username === messageWithId.username &&
             msg.message === messageWithId.message &&
             Math.abs((msg.timestamp || 0) - (messageWithId.timestamp || now)) < 1000)
        )
        if (isDuplicate) {
          return prev
        }
        const newMessages = [...prev, messageWithId]
        
        // Update oldest timestamp: find the oldest chat message in the array
        const oldestChatMsg = newMessages.find(msg => msg.type === 'chat')
        if (oldestChatMsg) {
          setOldestTimestamp(oldestChatMsg.timestamp)
        }
        
        return newMessages
      })
      
      // Clear fallback timeout since we're receiving messages
      if (fallbackTimeoutRef.current) {
        clearTimeout(fallbackTimeoutRef.current)
        fallbackTimeoutRef.current = null
      }
      
      // Debounce: Clear any existing timeout and set a new one
      // This ensures loading stays true while messages are arriving in batches
      // and only sets it to false after messages stop arriving for 500ms
      if (loadingTimeoutRef.current) {
        clearTimeout(loadingTimeoutRef.current)
      }
      loadingTimeoutRef.current = setTimeout(() => {
        setIsLoading(false)
        loadingTimeoutRef.current = null
      }, 500) // Wait 500ms after last message before hiding loading
    }

    ws.onerror = (error) => {
      console.error('WebSocket error:', error)
      // Don't show error to user if it's just a connection issue
      // The onclose handler will handle reconnection if needed
    }

    ws.onclose = () => {
      setIsConnected(false)
      setSocket(null)
      socketRef.current = null
    }

    return () => {
      if (loadingTimeoutRef.current) {
        clearTimeout(loadingTimeoutRef.current)
        loadingTimeoutRef.current = null
      }
      if (fallbackTimeoutRef.current) {
        clearTimeout(fallbackTimeoutRef.current)
        fallbackTimeoutRef.current = null
      }
      if (historyTimeoutRef.current) {
        clearTimeout(historyTimeoutRef.current)
        historyTimeoutRef.current = null
      }
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close()
      }
      socketRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!isLoading && messages.length > 0 && !isPrependingHistoryRef.current && !isProcessingHistoryRef.current) {
      // Scroll to bottom when loading is complete and messages exist
      // But only if we're not currently loading history (prepending messages)
      // and not processing history buffer
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [isLoading, messages.length])

  // Spam detection logic
  useEffect(() => {
    let cooldownInterval = null
    
    if (isSpamDetected && spamCooldown > 0) {
      cooldownInterval = setInterval(() => {
        setSpamCooldown(prev => {
          if (prev <= 1) {
            setIsSpamDetected(false)
            return 0
          }
          return prev - 1
        })
      }, 1000)
    }

    return () => {
      if (cooldownInterval) {
        clearInterval(cooldownInterval)
      }
    }
  }, [isSpamDetected, spamCooldown])

  const checkSpam = () => {
    const now = Date.now()
    const twoSecondsAgo = now - 2000
    
    // Add current timestamp to the array
    messageTimestampsRef.current.push(now)
    
    // Filter timestamps to only include those within the last 2 seconds
    messageTimestampsRef.current = messageTimestampsRef.current.filter(
      timestamp => timestamp > twoSecondsAgo
    )
    
    // Check if 5 or more messages were sent within 2 seconds
    if (messageTimestampsRef.current.length >= 5) {
      setIsSpamDetected(true)
      setSpamCooldown(5) // 5 second cooldown
      return false // Block the message
    }
    
    return true // Allow the message
  }

  // Update oldest timestamp when messages change
  useEffect(() => {
    const oldestChatMsg = messages.find(msg => msg.type === 'chat')
    if (oldestChatMsg && (!oldestTimestamp || oldestChatMsg.timestamp < oldestTimestamp)) {
      setOldestTimestamp(oldestChatMsg.timestamp)
    }
  }, [messages, oldestTimestamp])

  // Handle scroll to top for loading more messages
  useEffect(() => {
    const container = messagesContainerRef.current
    if (!container) return

    let scrollTimeout = null
    const handleScroll = () => {
      // Debounce scroll events
      if (scrollTimeout) {
        clearTimeout(scrollTimeout)
      }
      
      scrollTimeout = setTimeout(() => {
        // Check if user scrolled to top (within 100px)
        if (container.scrollTop < 100 && !isLoadingMore && hasMoreHistory && oldestTimestamp && socket && socket.readyState === WebSocket.OPEN) {
          setIsLoadingMore(true)
          
          // Use the oldest timestamp we have
          socket.send(JSON.stringify({
            type: 'load_more',
            before: oldestTimestamp,
            limit: 50
          }))
        }
      }, 100) // 100ms debounce
    }

    container.addEventListener('scroll', handleScroll)
    return () => {
      container.removeEventListener('scroll', handleScroll)
      if (scrollTimeout) {
        clearTimeout(scrollTimeout)
      }
    }
  }, [isLoadingMore, hasMoreHistory, oldestTimestamp, socket])

  const handleSendMessage = (e) => {
    e.preventDefault()
    if (message.trim() && socket && socket.readyState === WebSocket.OPEN) {
      // Check for spam before sending
      if (!checkSpam()) {
        return // Block the message if spam is detected
      }
      
      socket.send(
        JSON.stringify({
          type: 'chat',
          username,
          message: message.trim(),
        })
      )
      setMessage('')
    }
  }

  const handleLogout = async () => {
    if (socket) {
      socket.close()
    }
    await onLogout()
    navigate('/login')
  }

  const getMessageAlignment = (msg) => {
    return msg.username === username ? 'chat-end' : 'chat-start'
  }

  const getMessageColor = (msg) => {
    if (msg.type === 'system') {
      return 'chat-bubble-info'
    }
    return msg.username === username ? 'chat-bubble-primary' : 'chat-bubble-neutral'
  }

  const shouldShowUsername = (msg, index) => {
    if (msg.type === 'system') {
      return false
    }
    
    const prevMsg = messages[index - 1]
    const nextMsg = messages[index + 1]
    if (prevMsg && prevMsg.username !== msg.username) {
      return true
    }
    return false
  }

  const shouldShowAvatarAndHeader = (msg, index) => {
    // Only chat messages have avatars (system messages don't)
    if (msg.type !== 'chat') {
      return false
    }
    
    // Must have a username to show avatar
    if (!msg.username) {
      return false
    }
    
    const nextMsg = messages[index + 1]
    
    // Show avatar if there's no next message (it's the last message)
    if (!nextMsg) {
      return true
    }
    
    // Show avatar if next message is system (end of chat messages)
    if (nextMsg.type === 'system') {
      return true
    }
    
    // Show avatar if next message is not a chat message
    if (nextMsg.type !== 'chat') {
      return true
    }
    
    // Show avatar if next message is from a different user (end of this user's message group)
    if (nextMsg.username !== msg.username) {
      return true
    }
    
    // Don't show avatar if next message is from the same user (middle of group)
    return false
  }

  const isPartOfGroup = (msg, index) => {
    if (msg.type === 'system') {
      return false
    }
    
    const prevMsg = messages[index - 1]
    const nextMsg = messages[index + 1]
    
    const hasSameUserBefore = prevMsg && prevMsg.type === 'chat' && prevMsg.username === msg.username
    const hasSameUserAfter = nextMsg && nextMsg.type === 'chat' && nextMsg.username === msg.username
    
    return hasSameUserBefore || hasSameUserAfter
  }

  return (
    <div className="flex flex-col h-screen bg-base-200">
      {/* Header */}
      <div className="navbar bg-base-100 shadow-lg">
        <div className="flex-1">
          <h1 className="text-xl font-bold">Chat Room</h1>
        </div>
        <div className="flex-none gap-2">
          <div className="flex items-center gap-2">
            <div className={`badge ${isConnected ? 'badge-success' : 'badge-error'}`}>
              {isConnected ? 'Connected' : 'Disconnected'}
            </div>
            <span className="text-sm">Welcome, {username}!</span>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={handleLogout}>
            Logout
          </button>
        </div>
      </div>

      {/* Messages Container */}
      <div 
        ref={messagesContainerRef}
        className="flex-1 overflow-y-auto p-4"
      >
        {/* Loading indicator at top when loading more messages */}
        {isLoadingMore && (
          <div className="flex items-center justify-center py-4">
            <div className="flex flex-col items-center gap-2">
              <div className="loading loading-spinner loading-sm"></div>
              <p className="text-sm text-base-content/60">Loading older messages...</p>
            </div>
          </div>
        )}
        
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <div className="flex flex-col items-center gap-4">
              <div className="loading loading-spinner loading-lg"></div>
              <p className="text-base-content/60">Loading messages...</p>
            </div>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-base-content/60">No messages yet. Start the conversation!</p>
          </div>
        ) : (
          messages.map((msg, index) => {
            const messageKey = msg.id || index
            const showAvatarAndHeader = shouldShowAvatarAndHeader(msg, index)
            const showUsername = shouldShowUsername(msg, index)

            let spacingClass = 'mt-0'
            if (index === 0) {
              spacingClass = 'mt-0'
            } else {
              const prevMsg = messages[index - 1]
              if (prevMsg && prevMsg.type === 'chat' && prevMsg.username !== msg.username) {
                spacingClass = 'mt-4'
              } else if (prevMsg && prevMsg.type === 'system') {
                spacingClass = 'mt-4'
              }
            }
            
            if (msg.type === 'system') {
              return (
                <div key={messageKey} className={`flex justify-center ${spacingClass}`}>
                  <span className="badge badge-dash badge-neutral">{msg.message}</span>
                </div>
              )
            } else {
              return (
                <div key={messageKey} className={`chat ${getMessageAlignment(msg)} ${spacingClass}`}>
                  <div className="chat-image avatar">
                    {showAvatarAndHeader && msg.username ? (
                      <div className="w-10 h-10 rounded-full bg-primary text-primary-content flex items-center justify-center font-bold text-sm shrink-0">
                        <img src={"https://ui-avatars.com/api/?background=" + getAvatarColor(msg.username) + "&color=fff&name=" + msg.username} alt="Avatar" className="w-10 h-10 rounded-full" />
                      </div>
                    ) : (
                      <div className="w-10 h-10 shrink-0"></div>
                    )}
                  </div>
                  {showUsername && (
                    <div className="chat-header">
                      <span className="text-sm font-bold opacity-70">{msg.username}</span>
                    </div>
                  )}
                  <div className={`chat-bubble ${getMessageColor(msg)}`}>
                    {msg.message}
                  </div>
                  <div className="chat-footer opacity-50 text-xs">
                    {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              )
            }
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="bg-base-100 border-t border-base-300 p-4">
        {/* Spam Warning Badge */}
        {isSpamDetected && (
          <div className="mb-3 flex justify-center">
            <span className="badge badge-error badge-lg text-white animate-pulse">
              Spam detected. Please wait {spamCooldown} seconds.
            </span>
          </div>
        )}
        <form onSubmit={handleSendMessage} className="flex gap-2">
          <input
            type="text"
            placeholder="Type a message..."
            className="input input-bordered flex-1"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            disabled={!isConnected || isSpamDetected}
          />
          <button
            type="submit"
            className="btn btn-primary"
            disabled={!isConnected || !message.trim() || isSpamDetected}
          >
            Send
          </button>
        </form>
      </div>
    </div>
  )
}

export default ChatRoom

import { Component, type ReactNode } from 'react'

/** Shows render errors on screen instead of unmounting to a blank page. */
export default class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div className="p-4 text-sm">
        <p className="font-bold">เกิดข้อผิดพลาด กรุณาแคปหน้าจอนี้ส่งให้ผู้พัฒนา</p>
        <pre className="mt-2 whitespace-pre-wrap break-words text-ink-2">
          {error.message}
          {'\n'}
          {error.stack}
          {'\n'}
          {navigator.userAgent}
        </pre>
        <button className="mt-3 rounded-full bg-accent px-4 py-2 font-bold text-black" onClick={() => location.reload()}>
          โหลดใหม่
        </button>
      </div>
    )
  }
}

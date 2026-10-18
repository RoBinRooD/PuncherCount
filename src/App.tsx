import { NavLink, Route, Routes } from 'react-router-dom'
import Train from './pages/Train'
import History from './pages/History'
import SessionDetail from './pages/SessionDetail'
import SettingsPage from './pages/Settings'
import Teach from './pages/Teach'
import { useSettings } from './lib/settings'

const tabs = [
  { to: '/', label: 'ฝึกซ้อม', icon: '🥊' },
  { to: '/history', label: 'แดชบอร์ด', icon: '📊' },
  { to: '/teach', label: 'สอนท่า', icon: '🎯' },
  { to: '/settings', label: 'ตั้งค่า', icon: '⚙️' },
]

export default function App() {
  const [settings, updateSettings] = useSettings()
  return (
    <div className="flex h-full flex-col">
      <main className="min-h-0 flex-1 overflow-y-auto">
        <Routes>
          <Route path="/" element={<Train settings={settings} />} />
          <Route path="/history" element={<History />} />
          <Route path="/session/:id" element={<SessionDetail />} />
          <Route path="/teach" element={<Teach settings={settings} update={updateSettings} />} />
          <Route path="/settings" element={<SettingsPage settings={settings} update={updateSettings} />} />
        </Routes>
      </main>
      <nav className="flex border-t border-line bg-panel pb-[env(safe-area-inset-bottom)]">
        {tabs.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end
            className={({ isActive }) =>
              `flex flex-1 flex-col items-center gap-0.5 py-2 text-xs ${isActive ? 'text-ink' : 'text-ink-3'}`
            }
          >
            <span className="text-lg" aria-hidden>
              {t.icon}
            </span>
            {t.label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}

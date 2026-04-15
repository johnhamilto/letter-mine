/** Settings drawer — Preact component: button + right-edge drawer. */

import { render } from 'preact'
import type { Settings } from './state'

const CAP_PRESETS: ReadonlyArray<{ value: number; label: string; hint: string }> = [
  { value: 0.25, label: '25%', hint: 'Lowest lag' },
  { value: 0.5, label: '50%', hint: '' },
  { value: 0.75, label: '75%', hint: '' },
  { value: 0.9, label: '90%', hint: 'Default' },
  { value: 1.0, label: 'Off', hint: 'Fill basin' },
]

export interface SettingsProps {
  open: boolean
  settings: Settings
  basinCapacity: number
  onOpen: () => void
  onClose: () => void
  onChange: (next: Partial<Settings>) => void
}

function SettingsDrawer(props: SettingsProps) {
  const { open, settings, basinCapacity, onOpen, onClose, onChange } = props
  const capAbsolute = Math.floor(basinCapacity * settings.autoMinerCapPercent)

  return (
    <>
      <button
        class={`settings-btn${open ? ' settings-open' : ''}`}
        onClick={() => (open ? onClose() : onOpen())}
        aria-label="Settings"
        title="Settings"
      >
        Settings
      </button>
      <div class={`settings-overlay${open ? ' open' : ''}`}>
        <div class="settings-panel" onMouseDown={(e) => e.stopPropagation()}>
          <div class="settings-header">
            <h2>Settings</h2>
            <button class="settings-close" onClick={onClose}>
              X
            </button>
          </div>
          <div class="settings-content">
            <div class="settings-section">
              <h3>Auto-Miner Cap</h3>
              <p class="settings-hint">
                Auto-miner pauses when the basin fills past this threshold. Manual mining is never
                capped. Lower it if the game is dropping frames.
                {settings.autoMinerCapPercent < 1
                  ? ` Currently pauses around ${capAbsolute} letters.`
                  : ' Currently never pauses.'}
              </p>
              <div class="settings-presets">
                {CAP_PRESETS.map((p) => (
                  <button
                    key={p.value}
                    class={`settings-preset${settings.autoMinerCapPercent === p.value ? ' active' : ''}`}
                    onClick={() => onChange({ autoMinerCapPercent: p.value })}
                  >
                    <div class="settings-preset-label">{p.label}</div>
                    {p.hint && <div class="settings-preset-hint">{p.hint}</div>}
                  </button>
                ))}
              </div>
            </div>

            <div class="settings-section">
              <h3>Performance Monitor</h3>
              <p class="settings-hint">
                Show FPS, letter count, and physics step time in the corner.
              </p>
              <label class="settings-toggle">
                <input
                  type="checkbox"
                  checked={settings.perfMonitorEnabled}
                  onChange={(e) => onChange({ perfMonitorEnabled: e.currentTarget.checked })}
                />
                <span>Show perf monitor</span>
              </label>
            </div>

            <div class="settings-section">
              <h3>Audio</h3>
              <label class="settings-toggle">
                <input
                  type="checkbox"
                  checked={settings.muted}
                  onChange={(e) => onChange({ muted: e.currentTarget.checked })}
                />
                <span>Mute sound</span>
              </label>
            </div>

            <div class="settings-section">
              <h3>Apprentice Effect</h3>
              <p class="settings-hint">
                Choose how letters vanish when an apprentice consumes them.
              </p>
              <div class="settings-presets">
                <button
                  class={`settings-preset${settings.apprenticeFx === 'fade-drift' ? ' active' : ''}`}
                  onClick={() => onChange({ apprenticeFx: 'fade-drift' })}
                >
                  <div class="settings-preset-label">Fade</div>
                  <div class="settings-preset-hint">Subtle</div>
                </button>
                <button
                  class={`settings-preset${settings.apprenticeFx === 'ink-burst' ? ' active' : ''}`}
                  onClick={() => onChange({ apprenticeFx: 'ink-burst' })}
                >
                  <div class="settings-preset-label">Ink Burst</div>
                  <div class="settings-preset-hint">Splashy</div>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

const container = document.createElement('div')
container.id = 'settings-root'
document.body.appendChild(container)

export function renderSettings(props: SettingsProps) {
  render(<SettingsDrawer {...props} />, container)
}

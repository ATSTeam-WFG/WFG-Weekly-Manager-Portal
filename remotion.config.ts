import { Config } from '@remotion/cli/config'

// Local-rendering configuration only — this file is never read by
// anything deployed to Vercel (the actual render is only ever invoked via
// dev/local-video-render-plugin.ts, which is itself only registered
// during `vite dev`/local dev, never bundled or shipped).
Config.setVideoImageFormat('jpeg')
Config.setOverwriteOutput(true)

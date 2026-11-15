# Gospel Help for iOS

A native SwiftUI app with the web app's features (Search, Ask, Saved and Settings), designed for iOS 26's Liquid Glass. It runs on iPhone, iPad and the foldable iPhone Duo, and talks to the same API as the web client (`https://api.gospel.help`).

## Requirements

- Xcode 26 or later (built and tested with Xcode 27.2, iOS 27.2 simulators)
- iOS / iPadOS 26.0 deployment target
- [XcodeGen](https://github.com/yonaskolb/XcodeGen) to regenerate the project after adding or removing files (`brew install xcodegen`)

## Run it

```bash
cd ios
xcodegen                     # only needed after adding/removing files
open GospelHelp.xcodeproj    # then Run on any iPhone, iPad or iPhone Duo simulator
```

To use a local API (`uv run uvicorn app:app --port 10000` in `api/`), add the launch argument `-GHAPIBaseURL http://localhost:10000` in the scheme's Run options.

## Tests

```bash
# Unit tests: share-link codec (byte-compatible with the web), Ask SSE
# parsing, bookmark identity, display and sorting helpers, Markdown export.
xcodebuild -project GospelHelp.xcodeproj -scheme GospelHelp \
  -destination 'platform=iOS Simulator,name=iPhone 18 Pro' test

# End-to-end tour against the live API, saving a screenshot of every
# screen into the .xcresult. Variables: GH_NAME, GH_ORIENTATION
# (portrait|landscape), GH_THEME (light|dark), GH_ASK=1 (asks one real
# question, which counts against the day's Ask quota).
TEST_RUNNER_GH_NAME=ipad TEST_RUNNER_GH_ORIENTATION=landscape \
xcodebuild -project GospelHelp.xcodeproj -scheme GospelHelpTour \
  -destination 'platform=iOS Simulator,name=iPad Pro 13-inch (M5)' \
  -resultBundlePath build/tour.xcresult test
xcrun xcresulttool export attachments --path build/tour.xcresult --output-path build/shots
```

## How it maps to the web app

| Web (`client/src`) | iOS (`ios/GospelHelp`) |
|---|---|
| `components/mobile/mobile-app.tsx`, `tab-bar.tsx`, `sidebar.tsx` | `App/RootView.swift`: `TabView` with `.sidebarAdaptable` (floating glass tab bar on iPhone, top bar or sidebar on iPad), the reading pane, toasts |
| `App.tsx` search logic, `lib/search.ts`, `lib/passages.ts` | `Features/Search/SearchModel.swift`, `Services/APIClient.swift` |
| `search-box.tsx`, `scripture-box.tsx`, `filter-sheet.tsx`, `speaker-year-filter.tsx`, `recent-searches.tsx` | `Features/Search/SearchTab.swift`, `FilterSheet.swift` |
| `result-card.tsx`, `result-sheet.tsx`, `passage-context.tsx` | `Features/Passage/ResultCard.swift`, `PassageDetail.swift` |
| `ask-tab.tsx`, `answer-text.tsx`, `lib/ask.ts` | `Features/Ask/*`, `Services/AskService.swift` |
| `saved-tab.tsx`, `lib/bookmarks.ts`, `lib/markdown-export.ts` | `Features/Saved/SavedTab.swift`, `Stores/BookmarkStore.swift`, `Services/MarkdownExport.swift` |
| `lib/share.ts`, `lib/ask-share.ts`, `shared-collection.tsx`, `shared-answer.tsx` | `Services/ShareCodec.swift`, `Features/Shared/IncomingLinkView.swift` |
| `settings-tab.tsx`, `mcp-dialog.tsx`, `pages/stats.tsx` | `Features/Settings/SettingsTab.swift`, `Features/Stats/*` |
| `lib/backend.ts`, `use-online.ts`, service-worker caching | `Stores/AppStatus.swift`, `ResponseCache` in `APIClient.swift` |

## Layout by device

The layout follows the window's size, not the device model, so iPad multitasking windows and the iPhone Duo's two poses work the same way:

- **Narrow** (iPhones, the Duo folded on its 466×678pt outer panel): the system tab bar, and passages open in a glass sheet (medium/large detents).
- **Regular width** (iPad portrait, windows ≥ ~700pt): the iPadOS floating tab bar, which can become a sidebar; a centered 700pt reading column; passages still open in a sheet.
- **Wide** (≥ 1100pt, e.g. iPad landscape) **or wide-but-short** (≥ 880pt wide and under 760pt tall: the Duo unfolded at 951×669pt, large iPhones in landscape): a split view with the passage in a reading pane beside the list. Folding or rotating moves an open passage between the pane and a sheet without losing it.

## Behaviour notes

- **Saved passages** live in Application Support (`bookmarks.json`), whole, so Saved opens offline. Identity matches the web: the API id, else the web's older `source:url:hash(text)` key.
- **Offline:** GET responses (searches, context, speakers, stats) are also written to a disk cache and served when a request fails, like the web's service worker. Saving a passage prefetches its context.
- **Share links** are byte-compatible with the web (`https://gospel.help/#saved=v1.…` and `#ask=v1.…`): links made in the app open on the web, and the app opens web links passed to it as `gospelhelp://open#saved=…` (or a `gospel.help` link once universal links are set up). Decoding treats links as untrusted, with the same caps and host allow-list as the web.
- **Ask** posts to `/ask` with `Origin: https://gospel.help`, since the API only serves Ask to Gospel Help origins. Per-IP quotas and the daily budget apply to the app as to any caller.

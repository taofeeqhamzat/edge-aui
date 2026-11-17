# Supported Devices and Input

The testbed records mouse/pointer dynamics for tasks T1–T4. Touch and mobile interaction are
outside the supported modality, so the application refuses access before a participant session or
any behavioural trace is created.

## Supported environment

A desktop or laptop browser is supported when **all** of the following hold:

- The device is not a mobile/tablet context.
- A fine pointer exists: `(any-pointer: fine)` matches.
- The primary pointer is not coarse: `(pointer: coarse)` does not match.
- The primary input can hover: `(hover: none)` does not match.

A touchscreen laptop with a mouse or trackpad remains supported: it has a fine, hover-capable
pointer, so the interaction modality is mouse/pointer. `navigator.maxTouchPoints` alone is a
capability count, not the modality in use, and is not treated as a block by itself.

## Exact block rule

The visit is blocked if **any** of these is true:

1. **Mobile device context.** Any of:
   - `navigator.userAgentData.mobile === true`;
   - the user agent matches
     `/(Android|iPhone|iPad|iPod|Mobile|Tablet|Kindle|Silk|PlayBook|Windows Phone|IEMobile|Opera Mini|webOS|BlackBerry)/i`;
   - `navigator.platform === "MacIntel"` and `navigator.maxTouchPoints > 1` (iPadOS reports a
     desktop Macintosh user agent).
2. **No fine pointer.** `window.matchMedia("(any-pointer: fine)").matches` is false.
3. **Coarse primary pointer.** `window.matchMedia("(pointer: coarse)").matches` is true.
4. **No hover on the primary input.** `window.matchMedia("(hover: none)").matches` is true.

Viewport width, CSS breakpoints and screen orientation are **not** inputs to the rule. A narrow
desktop window is supported; a wide tablet is not. This is what prevents a responsive layout change
or an orientation change from enabling access.

The implementation is
[`src/testbed/entry/deviceSupport.ts`](../../src/testbed/entry/deviceSupport.ts).

## Pre-session blocking location

The gate is installed in
[`src/main.tsx`](../../src/main.tsx), before React mounts the testbed and before `start()` calls
`bootRuntime()`.

`bootRuntime()` is the only pre-task path that calls `sessionManager.startSession()`, starts the
passive observer and begins research collection. If the gate does not call
`onAccessGranted`, none of those run. Consequently a blocked visit has:

- no participant session or session identifier;
- no task session;
- no behavioural events, MicroTensor windows, macro interactions, outcomes or interventions;
- no local session record and no upload attempt.

The notice is plain DOM rendered by
[`src/testbed/entry/entryGate.ts`](../../src/testbed/entry/entryGate.ts). It imports nothing from
`src/telemetry` or the runtime pipeline, so the restriction is outside behavioural collection and
cannot contaminate participant data.

## Blocked screen

The blocked screen is one short line, with no testbed navigation or controls:

> Explore this study on a desktop or laptop using a mouse/pointer device; touch-based participation
> is not supported.

The message is also exported as `UNSUPPORTED_DEVICE_MESSAGE`.

## Re-evaluation and bypass protection

The gate re-evaluates on:

- `change` events for the three capability media queries;
- `resize`;
- `orientationchange`;
- `popstate` and `hashchange` (direct or history navigation);
- `pageshow` (back/forward cache restore).

The application is a single-page testbed with no distinct testbed routes. Every load, including a
direct URL or a reload, passes through the same entry gate. If a supported device becomes
unsupported, `onAccessRevoked` stops the runtime and unmounts the testbed, then shows the notice.

## Scope

This is a study-integrity control, not a security boundary. It uses browser capability signals; it
does not attempt to defeat a deliberately spoofed user agent or a script that forges media queries.

## Verification

```bash
npx vitest run tests/testbed_device_support.test.ts
npm run typecheck
```

The tests cover the rule for desktop, mobile, iPadOS desktop-mode, touch-only, coarse-primary and
no-hover devices; the notice and refusal path; absence of a session for a blocked visit; and
re-evaluation on orientation, resize and navigation events.

Browser verification was also run against the Vite development server in headless Chrome:

| Scenario | Result |
|---|---|
| Desktop 1280×800 | Testbed mounted; session shown in the trial controls |
| Desktop 390×844 (narrow responsive layout) | Testbed mounted; a narrow window is not a mobile signal |
| iPhone 12 emulation, 390×844 | Notice shown; no `.app-container` |
| iPhone 12 emulation, 844×390 (landscape) | Notice shown |
| iPhone 12 emulation widened to 1440×900 after load | Notice shown; no testbed |
| iPhone 12 direct route `/analytics` | Notice shown; no `.app-container` |
| iPhone 12 `history.pushState` to `/reports` | Notice shown; no `.app-container` |
| Blocked visit storage | No `localStorage`, `sessionStorage` or IndexedDB entries |


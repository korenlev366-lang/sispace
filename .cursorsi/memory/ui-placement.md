# UI placement preferences

- Question UI, plan UI, model list, auth dialog, and backend picker must all appear **below the prompt** (at the bottom of the TUI), not at the top.
- The transcript is hidden while those overlays are open.
- This placement prevents the UI from being lost under the transcript.
- Model list / auth / backend share the same bottom slot as plan/question (above PromptLine with flexGrow + justify-content: flex-end).
- **SkillPicker (auto-skill Accept/Reject)** also sits above the prompt, but the transcript stays visible so the agent can keep streaming while you decide.

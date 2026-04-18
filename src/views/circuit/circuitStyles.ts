export const circuitStyles = `
    html, body { height: 100%; }
    body { margin: 0; overflow: hidden; background: #070b18; color: #e2e8f0; font-family: Segoe UI, Tahoma, sans-serif; }
    #hud {
      position: absolute;
      top: 10px;
      left: 10px;
      right: 10px;
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 8px;
      pointer-events: none;
    }
    #hudControls {
      position: absolute;
      top: 0;
      right: 0;
      pointer-events: auto;
      display: flex;
      gap: 3px;
      align-items: center;
      z-index: 20;
      background: rgba(10, 18, 37, 0.9);
      border: 1px solid rgba(58, 84, 130, 0.78);
      border-radius: 9px;
      padding: 2px;
      box-shadow: 0 5px 15px rgba(0, 0, 0, 0.24);
      backdrop-filter: blur(10px);
    }
    .hud-control-btn {
      width: 27px;
      height: 24px;
      border: 1px solid rgba(90, 117, 162, 0.08);
      background: rgba(15, 27, 52, 0.35);
      color: #e5efff;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 700;
      line-height: 1;
      cursor: pointer;
      pointer-events: auto;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      transition: background 120ms ease, border-color 120ms ease, transform 120ms ease, color 120ms ease;
    }
    .hud-control-btn:hover {
      background: rgba(59, 130, 246, 0.28);
      border-color: rgba(156, 199, 255, 0.62);
      transform: translateY(-0.5px);
    }
    .hud-control-btn.active {
      border-color: rgba(34, 197, 94, 0.95);
      background: rgba(22, 163, 74, 0.3);
      color: #dcfce7;
    }
    .hud-control-btn:disabled {
      opacity: 0.42;
      cursor: default;
      color: #90a3c3;
      transform: none;
    }
    .hud-control-btn-icon {
      transform: translateY(-1px);
      user-select: none;
    }
    body.hud-minimized #hud .hud-main-card,
    body.hud-minimized #hud .hud-selection-card {
      display: none;
    }
    body.hud-maximized #hud .card {
      max-width: 470px;
      padding: 9px 10px;
    }
    body.hud-maximized #hud .hud-selection-card {
      max-width: 390px;
    }
    body.hud-minimized #hudControls {
      right: auto;
      left: 0;
    }
    .card {
      pointer-events: auto;
      background: linear-gradient(180deg, rgba(14, 24, 49, 0.86), rgba(10, 17, 35, 0.91));
      border: 1px solid rgba(60, 90, 136, 0.8);
      border-radius: 11px;
      padding: 8px 10px;
      backdrop-filter: blur(10px);
      max-width: 388px;
      max-height: calc(100vh - 20px);
      overflow-y: auto;
      overflow-x: hidden;
      box-shadow: 0 8px 22px rgba(0, 0, 0, 0.29);
    }
    .hud-main-card {
      width: clamp(280px, 28vw, 388px);
    }
    .hud-selection-card {
      width: clamp(230px, 22vw, 320px);
    }
    .title {
      font-weight: 700;
      margin-bottom: 4px;
      letter-spacing: 0.01em;
      font-size: 12px;
      color: #eaf2ff;
    }
    .muted {
      color: #aec0de;
      font-size: 11px;
      line-height: 1.35;
    }
    .mode-row { display: flex; gap: 8px; margin-top: 6px; pointer-events: auto; }
    .hud-sections {
      margin-top: 7px;
      display: grid;
      gap: 7px;
      pointer-events: auto;
    }
    .hud-section {
      border: 1px solid rgba(56, 85, 128, 0.74);
      background: rgba(8, 16, 35, 0.82);
      border-radius: 9px;
      overflow: hidden;
    }
    .hud-section-title {
      font-size: 10px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      font-weight: 700;
      color: #b8cae7;
      padding: 5px 8px;
      border-bottom: 1px solid rgba(56, 85, 128, 0.7);
      background: rgba(13, 24, 46, 0.78);
    }
    .hud-option-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 0;
    }
    .hud-option-grid.two-col {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .mode-btn {
      border: none;
      border-right: 1px solid rgba(56, 85, 128, 0.75);
      border-bottom: 1px solid rgba(56, 85, 128, 0.75);
      background: rgba(12, 22, 44, 0.74);
      color: #dce7f8;
      border-radius: 0;
      font-size: 11px;
      font-weight: 600;
      padding: 7px 8px;
      cursor: pointer;
      min-height: 28px;
      text-align: center;
      white-space: normal;
      line-height: 1.2;
      word-break: keep-all;
      transition: background 120ms ease, color 120ms ease, box-shadow 120ms ease;
    }
    .mode-btn:hover,
    .mini-btn:hover {
      background: rgba(37, 66, 108, 0.95);
      color: #f5f8ff;
    }
    .hud-option-grid .mode-btn:nth-child(3n) { border-right: none; }
    .hud-option-grid.two-col .mode-btn:nth-child(2n) { border-right: none; }
    .hud-option-grid .mode-btn:nth-last-child(-n + 3) { border-bottom: none; }
    .hud-option-grid.two-col .mode-btn:nth-last-child(-n + 2) { border-bottom: none; }
    .mode-btn.active {
      background: linear-gradient(180deg, rgba(22, 163, 74, 0.44), rgba(22, 163, 74, 0.22));
      color: #dcfce7;
      box-shadow: inset 0 0 0 1px rgba(34, 197, 94, 0.75);
    }
    .mini-btn {
      border: none;
      border-right: 1px solid rgba(56, 85, 128, 0.75);
      border-bottom: 1px solid rgba(56, 85, 128, 0.75);
      background: rgba(12, 22, 44, 0.74);
      color: #dce7f8;
      border-radius: 0;
      font-size: 11px;
      font-weight: 600;
      padding: 7px 8px;
      cursor: pointer;
      pointer-events: auto;
      min-height: 28px;
      text-align: center;
      white-space: normal;
      line-height: 1.2;
      word-break: keep-all;
      transition: background 120ms ease, color 120ms ease, box-shadow 120ms ease;
    }
    .scope-section .hud-option-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    #codeFlowBtn {
      grid-column: 1 / -1;
    }
    .mini-btn.active {
      background: linear-gradient(180deg, rgba(22, 163, 74, 0.44), rgba(22, 163, 74, 0.22));
      color: #dcfce7;
      box-shadow: inset 0 0 0 1px rgba(34, 197, 94, 0.75);
    }
    .mini-btn:disabled {
      opacity: 0.4;
      cursor: default;
    }
    #selectionActions {
      margin-top: 7px;
      pointer-events: auto;
    }
    #includeExternalBtn {
      display: none;
    }
    #disconnectContextBtn {
      display: none;
    }
    #modeHint {
      margin-top: 7px;
      color: #a9bcda;
      font-size: 10px;
      border: 1px solid rgba(56, 85, 128, 0.62);
      background: rgba(12, 22, 44, 0.52);
      border-radius: 8px;
      padding: 6px 8px;
      line-height: 1.45;
    }
    @media (max-width: 1120px) {
      #hud {
        top: 8px;
        left: 8px;
        right: 8px;
        gap: 6px;
      }
      .card {
        max-width: 350px;
      }
      .hud-main-card {
        width: clamp(250px, 40vw, 350px);
      }
      .hud-selection-card {
        width: clamp(220px, 34vw, 290px);
      }
      .hud-section-title {
        padding: 4px 7px;
      }
    }
    #aiInsights {
      margin-top: 8px;
      color: #d6e3f5;
      font-size: 11px;
      border: 1px solid rgba(55, 86, 134, 0.72);
      background: rgba(10, 26, 52, 0.55);
      border-radius: 9px;
      padding: 8px 10px;
      line-height: 1.5;
      max-height: 220px;
      overflow: auto;
      display: none;
    }
    #aiInsights .ai-md-block {
      font-size: 12px;
      color: #d6e3f5;
      line-height: 1.55;
    }
    #aiInsights .ai-md-sep {
      border: none;
      border-top: 1px solid rgba(84, 117, 171, 0.45);
      margin: 8px 0;
    }
    #aiInsights .ai-md-block p {
      margin: 5px 0;
    }
    #aiInsights .ai-md-block ul,
    #aiInsights .ai-md-block ol {
      margin: 6px 0 6px 16px;
      padding: 0;
    }
    #aiInsights .ai-md-block li {
      margin: 3px 0;
    }
    #aiInsights .ai-md-block h1,
    #aiInsights .ai-md-block h2,
    #aiInsights .ai-md-block h3 {
      margin: 7px 0 5px;
      color: #eff6ff;
      line-height: 1.35;
    }
    #aiInsights .ai-md-block h1 { font-size: 14px; }
    #aiInsights .ai-md-block h2 { font-size: 13px; }
    #aiInsights .ai-md-block h3 { font-size: 12px; }
    #aiInsights .ai-md-block code {
      background: rgba(10, 18, 36, 0.9);
      border: 1px solid rgba(84, 117, 171, 0.45);
      border-radius: 5px;
      padding: 1px 4px;
      font-family: Consolas, "Courier New", monospace;
      font-size: 11px;
      color: #e2e8f0;
    }
    #aiInsights .ai-md-block pre {
      background: rgba(8, 15, 30, 0.95);
      border: 1px solid rgba(84, 117, 171, 0.45);
      border-radius: 6px;
      padding: 7px;
      overflow: auto;
      margin: 6px 0;
      white-space: pre;
    }
    #aiInsights .ai-md-block pre code {
      border: none;
      background: transparent;
      padding: 0;
    }
    #aiSuggestions {
      margin-top: 8px;
      color: #d6e3f5;
      font-size: 11px;
      border: 1px solid rgba(55, 86, 134, 0.72);
      background: rgba(10, 26, 52, 0.55);
      border-radius: 9px;
      padding: 8px 10px;
      line-height: 1.45;
      max-height: 150px;
      overflow: auto;
      display: none;
    }
    .ai-suggestions-title {
      color: #dbeafe;
      font-weight: 700;
      margin-bottom: 6px;
    }
    .ai-suggestion-row {
      border: 1px solid rgba(55, 86, 134, 0.6);
      background: rgba(8, 20, 38, 0.66);
      border-radius: 8px;
      padding: 6px 8px;
      margin-bottom: 6px;
    }
    .ai-suggestion-line {
      color: #d6e3f5;
      margin-bottom: 5px;
      white-space: normal;
    }
    .ai-suggestion-actions {
      display: flex;
      gap: 6px;
    }
    .ai-suggestion-btn {
      border: 1px solid rgba(84, 117, 171, 0.85);
      background: rgba(15, 32, 62, 0.75);
      color: #e2e8f0;
      border-radius: 7px;
      padding: 4px 8px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
    }
    .ai-suggestion-btn:hover {
      background: rgba(34, 60, 101, 0.9);
    }
    .ai-suggestion-btn.reject {
      border-color: rgba(185, 86, 86, 0.85);
      background: rgba(56, 23, 23, 0.68);
    }
    .ai-suggestion-btn.reject:hover {
      background: rgba(94, 35, 35, 0.82);
    }
    .ai-suggestion-more {
      color: #a8bbd9;
      font-size: 11px;
      margin-top: 2px;
    }
    #relationState {
      margin-top: 8px;
      color: #c7d7ef;
      font-size: 11px;
      border: 1px solid rgba(55, 86, 134, 0.62);
      background: rgba(8, 20, 38, 0.66);
      border-radius: 8px;
      padding: 7px 9px;
      line-height: 1.45;
      white-space: normal;
    }
    #details {
      white-space: pre-wrap;
      font-family: Consolas, monospace;
      font-size: 12px;
      color: #cbd5e1;
      max-height: 240px;
      overflow: auto;
      padding-right: 2px;
    }
    #canvas { display: block; width: 100%; height: 100%; }
    #portTip {
      position: absolute;
      min-width: 140px;
      max-width: 320px;
      padding: 10px 12px;
      border-radius: 10px;
      border: 1px solid rgba(33, 48, 77, 0.95);
      background: rgba(15, 23, 42, 0.72);
      backdrop-filter: blur(10px);
      box-shadow: 0 10px 30px rgba(0,0,0,0.45);
      color: #e2e8f0;
      font-size: 12px;
      pointer-events: none;
      opacity: 0;
      transform: translateY(6px);
      transition: opacity 120ms ease, transform 120ms ease;
    }
    #portTip.show { opacity: 1; transform: translateY(0); }
    #portTip .k { color: #9fb0cc; }
    #portTip .v { color: #e2e8f0; font-weight: 600; }
    #nodeMenu {
      position: absolute;
      min-width: 120px;
      border-radius: 10px;
      border: 1px solid rgba(33, 48, 77, 0.95);
      background: rgba(15, 23, 42, 0.9);
      box-shadow: 0 10px 30px rgba(0,0,0,0.45);
      backdrop-filter: blur(8px);
      padding: 6px;
      display: none;
      z-index: 99;
    }
    #nodeMenu button {
      display: block;
      width: 100%;
      text-align: left;
      border: 1px solid transparent;
      border-radius: 8px;
      background: transparent;
      color: #e2e8f0;
      font-size: 12px;
      padding: 8px 10px;
      cursor: pointer;
    }
    #nodeMenu button:hover {
      background: rgba(34, 197, 94, 0.15);
      border-color: rgba(34, 197, 94, 0.35);
    }
    #fabWrap {
      position: absolute;
      right: 16px;
      bottom: 16px;
      z-index: 60;
      pointer-events: auto;
    }
    #fabAdd {
      width: 34px;
      height: 34px;
      border-radius: 999px;
      border: 1px solid rgba(51, 65, 85, 0.95);
      background: rgba(15, 23, 42, 0.9);
      color: #e2e8f0;
      font-size: 20px;
      line-height: 1;
      cursor: pointer;
      box-shadow: 0 8px 20px rgba(0, 0, 0, 0.35);
    }
    #fabMenu {
      margin-top: 6px;
      border-radius: 10px;
      border: 1px solid rgba(33, 48, 77, 0.95);
      background: rgba(15, 23, 42, 0.92);
      backdrop-filter: blur(8px);
      min-width: 140px;
      padding: 6px;
      transform-origin: bottom right;
      transform: scale(0.92);
      opacity: 0;
      pointer-events: none;
      transition: transform 180ms ease, opacity 180ms ease;
    }
    #fabMenu.show {
      transform: scale(1);
      opacity: 1;
      pointer-events: auto;
    }
    #fabMenu button {
      width: 100%;
      text-align: left;
      border: 1px solid transparent;
      border-radius: 8px;
      background: transparent;
      color: #e2e8f0;
      font-size: 12px;
      padding: 8px 10px;
      cursor: pointer;
    }
    #fabMenu button:hover {
      background: rgba(34, 197, 94, 0.15);
      border-color: rgba(34, 197, 94, 0.35);
    }
`;

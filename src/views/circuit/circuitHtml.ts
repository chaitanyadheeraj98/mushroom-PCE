export const circuitBody = `<div id="hud">
    <div id="hudControls">
      <button id="viewLockBtn" class="hud-control-btn" title="Lock view" aria-label="Lock view">
        <span class="hud-control-btn-icon">&#128275;</span>
      </button>
      <button id="hudMinBtn" class="hud-control-btn" title="Minimize HUD" aria-label="Minimize HUD">
        <span class="hud-control-btn-icon">&#8722;</span>
      </button>
      <button id="hudMaxBtn" class="hud-control-btn" title="Maximize HUD" aria-label="Maximize HUD">
        <span class="hud-control-btn-icon">&#9634;</span>
      </button>
    </div>
    <div class="card hud-main-card">
      <div class="title">Circuit Mode</div>
      <div id="graphifyContextIndicator" class="graphify-pill off">Graphify Context: Off</div>
      <div class="muted">Double-click to toggle Hand mode (pan). Hold Space + drag for temporary pan. Press F to fit graph in view. Drag nodes to rearrange. Scroll to zoom. In Runtime CodeFlow, click an output port then click Context Bot to wire context (repeat same action to detach).</div>
      <div class="hud-sections">
        <div class="hud-section">
          <div class="hud-section-title">View Mode</div>
          <div class="hud-option-grid two-col">
            <button id="modeArchitecture" class="mode-btn active">Architecture</button>
            <button id="modeRuntime" class="mode-btn">Runtime</button>
          </div>
        </div>
        <div class="hud-section">
          <div class="hud-section-title">Layout</div>
          <div class="hud-option-grid two-col">
            <button id="collapseAllBtn" class="mini-btn">Collapse All</button>
            <button id="expandAllBtn" class="mini-btn">Expand All</button>
          </div>
        </div>
        <div class="hud-section scope-section">
          <div class="hud-section-title">Scope</div>
          <div class="hud-option-grid">
            <button id="fullArchitectureBtn" class="mini-btn">Full Architecture</button>
            <button id="currentFileBtn" class="mini-btn">Current File</button>
            <button id="codeFlowBtn" class="mini-btn">CodeFlow</button>
          </div>
        </div>
        <div class="hud-section">
          <div class="hud-section-title">Dependencies</div>
          <div class="hud-option-grid two-col">
            <button id="depImportsBtn" class="mini-btn">Imports/Exports</button>
            <button id="depImportsCallsBtn" class="mini-btn">+ Call Hierarchy</button>
          </div>
        </div>
        <div class="hud-section">
          <div class="hud-section-title">Edges</div>
          <div class="hud-option-grid">
            <button id="edgeFilterBtn" class="mini-btn">Edges: All</button>
          </div>
        </div>
        <div class="hud-section">
          <div class="hud-section-title">AI</div>
          <div class="hud-option-grid">
            <button id="aiEnrichBtn" class="mini-btn">AI Insights</button>
            <button id="aiApplyAllBtn" class="mini-btn">Apply AI</button>
            <button id="aiRejectAllBtn" class="mini-btn">Reject AI</button>
          </div>
        </div>
        <div class="hud-section">
          <div class="hud-section-title">Relation Explain</div>
          <div class="hud-option-grid">
            <button id="relationSetFromBtn" class="mini-btn">Set From</button>
            <button id="relationSetToBtn" class="mini-btn">Set To</button>
            <button id="relationExplainBtn" class="mini-btn">Explain</button>
            <button id="relationResetBtn" class="mini-btn">Reset</button>
          </div>
          <div id="relationState">From: none | To: none</div>
        </div>
      </div>
      <div id="modeHint">Architecture view: grouped by layers.</div>
      <div id="aiInsights"></div>
      <div id="aiSuggestions"></div>
    </div>
    <div class="card hud-selection-card">
      <div class="title">Selection</div>
      <div id="details" class="muted">None</div>
      <div id="selectionActions" class="mode-row">
        <button id="includeExternalBtn" class="mini-btn">Include external neighbors</button>
        <button id="disconnectContextBtn" class="mini-btn">Disconnect connection</button>
      </div>
    </div>
  </div>
  <div id="portTip"></div>
  <div id="nodeMenu"></div>
  <div id="fabWrap">
    <button id="fabAdd" title="Add node" aria-label="Add node">+</button>
    <div id="fabMenu">
      <button id="addContextBotBtn">Context Bot</button>
    </div>
  </div>
  <canvas id="canvas"></canvas>`;

type CircuitHtmlInput = {
	cspSource: string;
	nonce: string;
	threeUri: string;
	jsmBaseUri: string;
	styles: string;
	body: string;
	script: string;
};

export function buildCircuitHtml(input: CircuitHtmlInput): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${input.cspSource} data:; style-src ${input.cspSource} 'unsafe-inline'; script-src 'nonce-${input.nonce}' ${input.cspSource};">
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Circuit Mode</title>
  <script nonce="${input.nonce}" type="importmap">
    {
      "imports": {
        "three": "${input.threeUri}",
        "three/examples/jsm/": "${input.jsmBaseUri}"
      }
    }
  </script>
  <style>
${input.styles}
  </style>
</head>
<body>
${input.body}
  <script nonce="${input.nonce}" type="module">
${input.script}
  </script>
</body>
</html>`;
}

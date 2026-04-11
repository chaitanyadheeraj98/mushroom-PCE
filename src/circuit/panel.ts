import * as vscode from 'vscode';

import { CircuitGraph, CircuitNode } from './types';

export class CircuitPanel {
	private static currentPanel: CircuitPanel | undefined;
	private readonly panel: vscode.WebviewPanel;
	private readonly disposables: vscode.Disposable[] = [];
	private readonly onNavigate?: (node: CircuitNode) => Promise<void>;

	static createOrShow(
		extensionUri: vscode.Uri,
		graph: CircuitGraph,
		onNavigate?: (node: CircuitNode) => Promise<void>
	): CircuitPanel {
		if (CircuitPanel.currentPanel) {
			CircuitPanel.currentPanel.panel.reveal(vscode.ViewColumn.Beside);
			CircuitPanel.currentPanel.setGraph(graph);
			return CircuitPanel.currentPanel;
		}

		const panel = vscode.window.createWebviewPanel('mushroomPceCircuit', 'Mushroom PCE: Circuit Mode', vscode.ViewColumn.Beside, {
			enableScripts: true,
			retainContextWhenHidden: true,
			// Allow loading Three.js from bundled deps.
			localResourceRoots: [extensionUri, vscode.Uri.joinPath(extensionUri, 'node_modules')]
		});

		CircuitPanel.currentPanel = new CircuitPanel(panel, extensionUri, graph, onNavigate);
		return CircuitPanel.currentPanel;
	}

	private constructor(
		panel: vscode.WebviewPanel,
		extensionUri: vscode.Uri,
		graph: CircuitGraph,
		onNavigate?: (node: CircuitNode) => Promise<void>
	) {
		this.panel = panel;
		this.onNavigate = onNavigate;
		this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
		this.panel.webview.onDidReceiveMessage(
			async (msg) => {
				if (msg?.type === 'navigate' && msg?.node && this.onNavigate) {
					await this.onNavigate(msg.node as CircuitNode);
				}
			},
			null,
			this.disposables
		);
		this.panel.webview.html = this.getHtml(this.panel.webview, extensionUri, graph);
	}

	dispose(): void {
		CircuitPanel.currentPanel = undefined;
		while (this.disposables.length) {
			this.disposables.pop()?.dispose();
		}
	}

	setGraph(graph: CircuitGraph): void {
		this.panel.webview.postMessage({ type: 'graph', graph });
	}

	private getHtml(webview: vscode.Webview, extensionUri: vscode.Uri, graph: CircuitGraph): string {
		const nonce = getNonce();
		const cspSource = webview.cspSource;
		const graphJson = JSON.stringify(graph).replace(/</g, '\\u003c');

		const threeUri = webview.asWebviewUri(
			vscode.Uri.joinPath(extensionUri, 'node_modules', 'three', 'build', 'three.module.js')
		);
		let jsmBaseUri = webview
			.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'node_modules', 'three', 'examples', 'jsm'))
			.toString();
		if (!jsmBaseUri.endsWith('/')) {
			jsmBaseUri += '/';
		}

		return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} data:; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${cspSource};">
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Circuit Mode</title>
  <script nonce="${nonce}" type="importmap">
    {
      "imports": {
        "three": "${threeUri}",
        "three/examples/jsm/": "${jsmBaseUri}"
      }
    }
  </script>
  <style>
    html, body { height: 100%; }
    body { margin: 0; overflow: hidden; background: #070b18; color: #e2e8f0; font-family: Segoe UI, Tahoma, sans-serif; }
    #hud {
      position: absolute; top: 12px; left: 12px; right: 12px;
      display: flex; justify-content: space-between; gap: 12px; pointer-events: none;
    }
    .card {
      pointer-events: none;
      background: rgba(15, 23, 42, 0.75);
      border: 1px solid rgba(33, 48, 77, 0.9);
      border-radius: 10px;
      padding: 10px 12px;
      backdrop-filter: blur(10px);
      max-width: 420px;
    }
    .title { font-weight: 700; margin-bottom: 6px; }
    .muted { color: #9fb0cc; font-size: 12px; }
    .mode-row { display: flex; gap: 8px; margin-top: 8px; pointer-events: auto; }
    .mode-btn {
      border: 1px solid rgba(33, 48, 77, 0.95);
      background: rgba(11, 18, 37, 0.8);
      color: #cbd5e1;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 600;
      padding: 5px 10px;
      cursor: pointer;
    }
    .mode-btn.active {
      border-color: rgba(34, 197, 94, 0.9);
      background: rgba(22, 163, 74, 0.3);
      color: #dcfce7;
    }
    .mini-btn {
      border: 1px solid rgba(33, 48, 77, 0.9);
      background: rgba(11, 18, 37, 0.72);
      color: #cbd5e1;
      border-radius: 8px;
      font-size: 11px;
      font-weight: 600;
      padding: 4px 8px;
      cursor: pointer;
      pointer-events: auto;
    }
    .mini-btn:disabled {
      opacity: 0.45;
      cursor: default;
    }
    #modeHint { margin-top: 6px; color: #9fb0cc; font-size: 11px; }
    #details { white-space: pre-wrap; font-family: Consolas, monospace; font-size: 12px; color: #cbd5e1; }
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
  </style>
</head>
<body>
  <div id="hud">
    <div class="card">
      <div class="title">Circuit Mode</div>
      <div class="muted">Double-click to toggle Hand mode (pan). Drag nodes to rearrange. Scroll to zoom. In Architecture view, click a layer node to collapse/expand it.</div>
      <div class="mode-row">
        <button id="modeArchitecture" class="mode-btn active">Architecture</button>
        <button id="modeRuntime" class="mode-btn">Runtime</button>
      </div>
      <div class="mode-row">
        <button id="collapseAllBtn" class="mini-btn">Collapse All</button>
        <button id="expandAllBtn" class="mini-btn">Expand All</button>
      </div>
      <div id="modeHint">Architecture view: grouped by layers.</div>
    </div>
    <div class="card" style="max-width: 520px;">
      <div class="title">Selection</div>
      <div id="details" class="muted">None</div>
    </div>
  </div>
  <div id="portTip"></div>
  <canvas id="canvas"></canvas>
  <script nonce="${nonce}" type="module">
    let THREE;
    let OrbitControls;
    try {
      THREE = await import('three');
      ({ OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js'));
    } catch (err) {
      const details = document.getElementById('details');
      details.textContent = 'Failed to load Three.js.\\n' + (err?.message ?? String(err));
      throw err;
    }

    const vscode = (typeof acquireVsCodeApi === 'function') ? acquireVsCodeApi() : undefined;
    const canvas = document.getElementById('canvas');
    const details = document.getElementById('details');
    const portTip = document.getElementById('portTip');
    const modeArchitectureBtn = document.getElementById('modeArchitecture');
    const modeRuntimeBtn = document.getElementById('modeRuntime');
    const collapseAllBtn = document.getElementById('collapseAllBtn');
    const expandAllBtn = document.getElementById('expandAllBtn');
    const modeHint = document.getElementById('modeHint');

    let graph = ${graphJson};
    let viewMode = 'architecture'; // architecture | runtime
    const collapsedLayers = new Set();

    try {
      const saved = vscode?.getState?.();
      if (saved && (saved.viewMode === 'architecture' || saved.viewMode === 'runtime')) {
        viewMode = saved.viewMode;
      }
      if (saved && Array.isArray(saved.collapsedLayers)) {
        for (let i = 0; i < saved.collapsedLayers.length; i++) {
          const key = saved.collapsedLayers[i];
          if (typeof key === 'string') {
            collapsedLayers.add(key);
          }
        }
      }
    } catch {}

    // Node-RED style 2D node graph (boxes + ports) on the Z=0 plane.
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x070b18);

    const renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    const camera = new THREE.OrthographicCamera(-400, 400, 300, -300, 0.1, 4000);
    camera.position.set(0, 0, 900);
    camera.lookAt(0, 0, 0);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableRotate = false;
    // We'll handle panning ourselves so it works consistently in VS Code webviews.
    controls.enablePan = false;
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    controls.screenSpacePanning = true;
    controls.zoomSpeed = 0.9;
    controls.minPolarAngle = Math.PI / 2;
    controls.maxPolarAngle = Math.PI / 2;
    controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN };
    // Disable built-in mouse bindings; we manage drag behaviors.
    controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };

    const grid = new THREE.GridHelper(2400, 96, 0x1f2a44, 0x101a32);
    grid.rotation.x = Math.PI / 2;
    grid.position.z = -2;
    scene.add(grid);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const dragPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    const dragPoint = new THREE.Vector3();

    const nodeGroup = new THREE.Group();
    const edgeGroup = new THREE.Group();
    const labelGroup = new THREE.Group();
    const particleGroup = new THREE.Group();
    scene.add(edgeGroup, particleGroup, labelGroup, nodeGroup);

    const NODE_W = 228;
    const NODE_H = 64;
    const NODE_HEADER_H = 18;
    const NODE_ICON_W = 24;
    const NODE_ICON_H = 24;
    const NODE_BODY_COLOR = 0x132238;
    const NODE_HEADER_COLOR = 0x1d3656;
    const NODE_ACCENT_COLOR = 0x7dd3fc;
    const layerColors = {
      system: 0xf59e0b,
      command: 0x38bdf8,
      orchestration: 0xa78bfa,
      state: 0xfacc15,
      ui: 0x34d399,
      feature: 0xfb7185,
      utility: 0x94a3b8,
      runtime: 0x7dd3fc
    };
    const palette = {
      function: NODE_ACCENT_COLOR,
      sink: 0xfbbf24,
      layer: 0x60a5fa,
      module: 0x22c55e,
      state: 0xfacc15,
      utility: 0x94a3b8
    };
    const portColors = {
      in: 0xa78bfa,   // purple
      out: 0x22c55e   // green
    };

    const nodeBodies = []; // array of meshes used for raycast
    const portMeshes = []; // array of meshes used for raycast
    const nodeByMeshUuid = new Map(); // mesh.uuid -> node
    const nodeMeta = new Map(); // node.id -> { group, body, w, h, node }
    const adjacency = new Map(); // nodeId -> edge indices
    const edges = []; // { edge, line, arrow, label, curve, particle, t }
    const nodeAnimations = []; // { group, target, targetScale, delay }
    const manualNodePositions = new Map(); // nodeId -> THREE.Vector3
    const cameraAnim = { x: 0, y: 0, zoom: 1, active: false };
    let lastFrameAt = 0;

    function clearSceneGroups() {
      for (const g of [nodeGroup, edgeGroup, labelGroup, particleGroup]) {
        while (g.children.length) g.remove(g.children[0]);
      }
      nodeBodies.length = 0;
      portMeshes.length = 0;
      nodeByMeshUuid.clear();
      nodeMeta.clear();
      adjacency.clear();
      edges.length = 0;
      nodeAnimations.length = 0;
    }

    function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

    function fitLabel(text, maxChars) {
      if (!text || text.length <= maxChars) return text;
      return text.slice(0, Math.max(0, maxChars - 1)) + '…';
    }

    function makeLabelSprite(text, colorHex) {
      const padX = 10;
      const padY = 8;
      const font = '600 14px Segoe UI, Tahoma, sans-serif';

      const canvasEl = document.createElement('canvas');
      const ctx = canvasEl.getContext('2d');
      ctx.font = font;
      const metrics = ctx.measureText(text);
      const w = Math.ceil(metrics.width + padX * 2);
      const h = 26 + padY;
      canvasEl.width = clamp(w, 120, 180);
      canvasEl.height = h;

      ctx.font = font;
      ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
      ctx.fillStyle = 'rgba(7, 11, 24, 0.0)';
      ctx.fillRect(0, 0, canvasEl.width, canvasEl.height);

      ctx.fillStyle = '#e2e8f0';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, padX, Math.floor(canvasEl.height / 2));

      const tex = new THREE.CanvasTexture(canvasEl);
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
      const spr = new THREE.Sprite(mat);
      // Scale to world units
      spr.scale.set(canvasEl.width * 0.55, canvasEl.height * 0.55, 1);
      spr.userData.kind = 'label';
      if (typeof colorHex === 'number') {
        spr.material.color = new THREE.Color(colorHex);
      }
      return spr;
    }

    function makeEdgeLabel(text) {
      const canvasEl = document.createElement('canvas');
      const ctx = canvasEl.getContext('2d');
      const font = '600 12px Segoe UI, Tahoma, sans-serif';
      ctx.font = font;
      const metrics = ctx.measureText(text);
      const w = clamp(Math.ceil(metrics.width + 18), 40, 220);
      const h = 22;
      canvasEl.width = w;
      canvasEl.height = h;
      ctx.font = font;
      ctx.fillStyle = 'rgba(15, 23, 42, 0.78)';
      roundRect(ctx, 0, 0, w, h, 8);
      ctx.fill();
      ctx.strokeStyle = 'rgba(33, 48, 77, 0.95)';
      ctx.lineWidth = 1;
      roundRect(ctx, 0.5, 0.5, w - 1, h - 1, 8);
      ctx.stroke();
      ctx.fillStyle = '#cbd5e1';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, 9, h / 2);

      const tex = new THREE.CanvasTexture(canvasEl);
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
      const spr = new THREE.Sprite(mat);
      spr.scale.set(w * 0.55, h * 0.55, 1);
      spr.userData.kind = 'edgeLabel';
      return spr;
    }

    function makePillSprite(text, bgRgba, fgHex) {
      const canvasEl = document.createElement('canvas');
      const ctx = canvasEl.getContext('2d');
      const font = '700 11px Segoe UI, Tahoma, sans-serif';
      ctx.font = font;
      const metrics = ctx.measureText(text);
      const w = clamp(Math.ceil(metrics.width + 14), 24, 100);
      const h = 20;
      canvasEl.width = w;
      canvasEl.height = h;
      ctx.font = font;
      ctx.fillStyle = bgRgba;
      roundRect(ctx, 0, 0, w, h, 8);
      ctx.fill();
      ctx.strokeStyle = 'rgba(33, 48, 77, 0.95)';
      ctx.lineWidth = 1;
      roundRect(ctx, 0.5, 0.5, w - 1, h - 1, 8);
      ctx.stroke();
      ctx.fillStyle = fgHex;
      ctx.textBaseline = 'middle';
      ctx.fillText(text, 7, h / 2);

      const tex = new THREE.CanvasTexture(canvasEl);
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
      const spr = new THREE.Sprite(mat);
      spr.scale.set(w * 0.55, h * 0.55, 1);
      return spr;
    }

    function roundRect(ctx, x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }

    function getCollapseKeyForNode(node) {
      if (!node || node.type !== 'layer') {
        return undefined;
      }
      if (typeof node.id !== 'string' || !node.id.startsWith('layer:')) {
        return undefined;
      }
      const key = node.id.slice('layer:'.length);
      return key === 'system-root' ? undefined : key;
    }

    function getLayerMemberCount(layerKey) {
      let count = 0;
      for (let i = 0; i < graph.nodes.length; i++) {
        const node = graph.nodes[i];
        if (node.type === 'function' && node.layer === layerKey) {
          count++;
        }
      }
      return count;
    }

    function getVisibleGraph(g) {
      const visibleNodes = [];
      const allowedNodeIds = new Set();
      for (let i = 0; i < g.nodes.length; i++) {
        const node = g.nodes[i];
        const includeInArchitecture = node.type === 'layer' || node.type === 'function';
        const includeInRuntime = node.type === 'function' || node.type === 'sink';
        const layerCollapsed = viewMode === 'architecture' && node.type === 'function' && node.layer && collapsedLayers.has(node.layer);
        const shouldInclude = (viewMode === 'architecture' ? includeInArchitecture : includeInRuntime) && !layerCollapsed;
        if (shouldInclude) {
          visibleNodes.push(node);
          allowedNodeIds.add(node.id);
        }
      }

      const visibleEdges = [];
      for (let i = 0; i < g.edges.length; i++) {
        const edge = g.edges[i];
        const isArchitectureEdge = edge.kind === 'architecture';
        const includeEdge = viewMode === 'architecture' ? isArchitectureEdge : !isArchitectureEdge;
        if (!includeEdge) continue;
        if (!allowedNodeIds.has(edge.from) || !allowedNodeIds.has(edge.to)) continue;
        visibleEdges.push(edge);
      }
      return { nodes: visibleNodes, edges: visibleEdges };
    }

    function layoutNodes(nodes) {
      if (viewMode === 'architecture') {
        const layerOrder = ['system', 'command', 'orchestration', 'state', 'ui', 'feature', 'utility', 'runtime'];
        const layers = new Map();
        for (let i = 0; i < layerOrder.length; i++) {
          layers.set(layerOrder[i], []);
        }
        for (let i = 0; i < nodes.length; i++) {
          const node = nodes[i];
          const key = node.layer || (node.type === 'layer' ? 'feature' : 'runtime');
          const arr = layers.get(key) || [];
          arr.push(node);
          layers.set(key, arr);
        }

        const positions = new Map();
        const rowGap = 178;
        const layerX = -290;
        const fnBaseX = 240;
        const fnColGap = 274;
        const fnRowGap = 112;
        const maxPerRow = 4;

        for (let li = 0; li < layerOrder.length; li++) {
          const layerKey = layerOrder[li];
          const y = (layerOrder.length / 2 - li) * rowGap;
          const lane = layers.get(layerKey) || [];
          const layerNode = lane.find((n) => n.type === 'layer');
          if (layerNode) {
            positions.set(layerNode.id, new THREE.Vector3(layerX, y, 0));
          }
          const members = lane.filter((n) => n.type !== 'layer');
          for (let mi = 0; mi < members.length; mi++) {
            const colsInThisLayer = Math.min(maxPerRow, Math.max(1, members.length));
            const col = mi % colsInThisLayer;
            const row = Math.floor(mi / colsInThisLayer);
            const totalRows = Math.ceil(members.length / colsInThisLayer);
            const colOffset = (col - (colsInThisLayer - 1) / 2) * fnColGap;
            const rowOffset = (row - (totalRows - 1) / 2) * fnRowGap;
            positions.set(members[mi].id, new THREE.Vector3(fnBaseX + colOffset, y + rowOffset, 0));
          }
        }

        for (let i = 0; i < nodes.length; i++) {
          if (!positions.has(nodes[i].id)) {
            positions.set(nodes[i].id, new THREE.Vector3(0, 0, 0));
          }
        }
        return positions;
      }

      const byType = new Map();
      for (const n of nodes) {
        const arr = byType.get(n.type) || [];
        arr.push(n);
        byType.set(n.type, arr);
      }
      // Function-only view: show only functions and sinks.
      const lanes = ['function', 'sink'];
      const positions = new Map();
      for (let li = 0; li < lanes.length; li++) {
        const type = lanes[li];
        const lane = byType.get(type) || [];
          const x = (li - (lanes.length - 1) / 2) * 340;
        for (let i = 0; i < lane.length; i++) {
          const y = (-(i - (lane.length - 1) / 2)) * 114;
          positions.set(lane[i].id, new THREE.Vector3(x, y, 0));
        }
      }
      for (const n of nodes) {
        if (!positions.has(n.id)) {
          positions.set(n.id, new THREE.Vector3(0, 0, 0));
        }
      }
      return positions;
    }

    function fitViewToGraph(targetPositions) {
      const items = Array.from(nodeMeta.values());
      if (!items.length) {
        cameraAnim.x = 0;
        cameraAnim.y = 0;
        cameraAnim.zoom = 1;
        cameraAnim.active = true;
        return;
      }

      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const meta of items) {
        const p = targetPositions && targetPositions.get(meta.node.id) ? targetPositions.get(meta.node.id) : meta.group.position;
        const left = p.x - (meta.w / 2);
        const right = p.x + (meta.w / 2);
        const top = p.y + (meta.h / 2);
        const bottom = p.y - (meta.h / 2);
        minX = Math.min(minX, left);
        maxX = Math.max(maxX, right);
        minY = Math.min(minY, bottom);
        maxY = Math.max(maxY, top);
      }

      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      const boundsW = Math.max(1, maxX - minX);
      const boundsH = Math.max(1, maxY - minY);
      const margin = 140;

      const viewW = Math.max(1, camera.right - camera.left);
      const viewH = Math.max(1, camera.top - camera.bottom);
      const zoomX = viewW / (boundsW + margin * 2);
      const zoomY = viewH / (boundsH + margin * 2);
      const nextZoom = clamp(Math.min(zoomX, zoomY), 0.35, 2.4);

      cameraAnim.x = cx;
      cameraAnim.y = cy;
      cameraAnim.zoom = nextZoom;
      cameraAnim.active = true;
    }

    function buildGraphScene(g) {
      const previousNodeState = new Map();
      for (const [id, meta] of nodeMeta.entries()) {
        previousNodeState.set(id, {
          position: meta.group.position.clone(),
          scale: meta.group.scale.x || 1
        });
      }
      clearSceneGroups();
      const isArchitectureMode = viewMode === 'architecture';
      const visibleGraph = getVisibleGraph(g);

      const positions = layoutNodes(visibleGraph.nodes);
      const laneTotals = new Map();
      const laneSeen = new Map();
      for (let i = 0; i < visibleGraph.edges.length; i++) {
        const edge = visibleGraph.edges[i];
        const key = edge.from + '=>' + edge.to;
        laneTotals.set(key, (laneTotals.get(key) || 0) + 1);
      }

      const portGeom = new THREE.SphereGeometry(5.2, 14, 14);
      const iconGeom = new THREE.BoxGeometry(NODE_ICON_W, NODE_ICON_H, 10);

      for (const node of visibleGraph.nodes) {
        const color = layerColors[node.layer] || palette[node.type] || 0x94a3b8;
        const labelText = fitLabel(node.label, 22);
        const w = node.type === 'layer' ? NODE_W - 42 : NODE_W;
        const h = node.type === 'layer' ? NODE_H - 16 : NODE_H;

        const group = new THREE.Group();
        const targetPosition = positions.get(node.id);
        const previous = previousNodeState.get(node.id);
        if (previous) {
          group.position.copy(previous.position);
        } else if (manualNodePositions.has(node.id)) {
          group.position.copy(manualNodePositions.get(node.id));
        } else if (isArchitectureMode && node.type === 'function' && node.layer) {
          const layerAnchor = positions.get('layer:' + node.layer);
          if (layerAnchor) {
            group.position.set(layerAnchor.x, layerAnchor.y, 0);
          } else {
            group.position.copy(targetPosition);
          }
        } else {
          group.position.copy(targetPosition);
        }
        group.userData.kind = 'nodeGroup';

        const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, 8), new THREE.MeshStandardMaterial({
          color: NODE_BODY_COLOR,
          roughness: 0.62,
          metalness: 0.08,
          emissive: 0x08111f,
          emissiveIntensity: 0.18
        }));
        body.userData.kind = 'nodeBody';
        body.userData.nodeId = node.id;

        const header = new THREE.Mesh(new THREE.BoxGeometry(w, NODE_HEADER_H, 9), new THREE.MeshStandardMaterial({
          color: NODE_HEADER_COLOR,
          roughness: 0.55,
          metalness: 0.1,
          emissive: 0x0b1830,
          emissiveIntensity: 0.12
        }));
        header.position.set(0, (h / 2) - (NODE_HEADER_H / 2), 0.6);

        const icon = new THREE.Mesh(iconGeom, new THREE.MeshStandardMaterial({
          color: color,
          roughness: 0.28,
          metalness: 0.18,
          emissive: color,
          emissiveIntensity: 0.14
        }));
        icon.position.set((-w / 2) + 18, 0, 0.8);

        const accent = new THREE.Mesh(new THREE.BoxGeometry(6, h, 9.2), new THREE.MeshStandardMaterial({
          color: color,
          roughness: 0.35,
          metalness: 0.12,
          emissive: color,
          emissiveIntensity: 0.18
        }));
        accent.position.set((-w / 2) + 3, 0, 0.7);

        const label = makeLabelSprite(labelText);
        label.position.set((-w / 2) + 80, 0, 6.5);
        if (isArchitectureMode && node.type === 'layer') {
          const layerKey = getCollapseKeyForNode(node);
          if (layerKey) {
            const collapsed = collapsedLayers.has(layerKey);
            const memberCount = getLayerMemberCount(layerKey);
            const badgeText = (collapsed ? '+' : '-') + ' ' + String(memberCount);
            const badge = makePillSprite(badgeText, 'rgba(11, 18, 37, 0.88)', '#cbd5e1');
            badge.position.set((w / 2) - 34, (h / 2) - 12, 7.4);
            group.add(badge);
          }
        }

        const inputs = !isArchitectureMode && Array.isArray(node.inputs) ? node.inputs : [];
        const outputs = !isArchitectureMode && Array.isArray(node.outputs) ? node.outputs : [];
        const ports = { in: [], out: [], byId: new Map() };

        const makePort = (x, y, dir, port) => {
          const mat = new THREE.MeshBasicMaterial({ color: dir === 'out' ? portColors.out : portColors.in });
          const p = new THREE.Mesh(portGeom, mat);
          p.position.set(x, y, 4.5);
          p.userData.kind = 'port';
          p.userData.nodeId = node.id;
          p.userData.portId = port.id;
          p.userData.direction = dir;
          p.userData.portName = port.name;
          p.userData.portKind = port.kind;
          p.userData.portDetail = port.detail || '';
          portMeshes.push(p);
          return p;
        };

        // Distribute ports along left/right edge.
        const portSpan = h - 22;
        const portStart = (h / 2) - 11;
        for (let i = 0; i < inputs.length; i++) {
          const t = (inputs.length === 1) ? 0.5 : (i / (inputs.length - 1));
          const y = portStart - t * portSpan;
          const port = inputs[i];
          const p = makePort((-w / 2) - 4, y, 'in', port);
          ports.in.push({ mesh: p, port: port });
          ports.byId.set(port.id, p);
          group.add(p);
        }
        for (let i = 0; i < outputs.length; i++) {
          const t = (outputs.length === 1) ? 0.5 : (i / (outputs.length - 1));
          const y = portStart - t * portSpan;
          const port = outputs[i];
          const p = makePort((w / 2) + 4, y, 'out', port);
          ports.out.push({ mesh: p, port: port });
          ports.byId.set(port.id, p);
          group.add(p);
        }

        group.add(body, header, accent, icon, label);
        nodeGroup.add(group);
        nodeBodies.push(body);
        nodeByMeshUuid.set(body.uuid, node);
        nodeMeta.set(node.id, { group: group, body: body, w: w, h: h, ports: ports, node: node });
        const targetScale = 1;
        const startScale = previous ? previous.scale : (isArchitectureMode ? 0.86 : 0.92);
        group.scale.setScalar(startScale);
        const delay = isArchitectureMode ? Math.max(0, (Math.abs(targetPosition.y) * 0.0007)) : 0;
        nodeAnimations.push({
          nodeId: node.id,
          group: group,
          target: targetPosition.clone(),
          targetScale: targetScale,
          delay: delay
        });
      }

      // Create edges (line + arrow + label + particle). Geometry is updated every frame in case nodes move.
      for (let ei = 0; ei < visibleGraph.edges.length; ei++) {
        const edge = visibleGraph.edges[ei];
        const lineGeom = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
        const edgeColor = edge.kind === 'architecture' ? 0x818cf8 : 0x3b82f6;
        const lineMat = new THREE.LineBasicMaterial({ color: edgeColor, transparent: true, opacity: edge.kind === 'architecture' ? 0.38 : 0.28 });
        const line = new THREE.Line(lineGeom, lineMat);
        edgeGroup.add(line);

        const arrow = new THREE.Mesh(
          new THREE.ConeGeometry(6.2, 16, 14),
          new THREE.MeshBasicMaterial({ color: edgeColor, transparent: true, opacity: 0.55 })
        );
        arrow.rotation.z = Math.PI / 2;
        arrow.visible = !isArchitectureMode;
        particleGroup.add(arrow);

        const particle = new THREE.Mesh(new THREE.SphereGeometry(4.0, 12, 12), new THREE.MeshBasicMaterial({ color: 0x22c55e }));
        particle.visible = !isArchitectureMode;
        particleGroup.add(particle);

        const laneKey = edge.from + '=>' + edge.to;
        const laneIndex = laneSeen.get(laneKey) || 0;
        laneSeen.set(laneKey, laneIndex + 1);
        const laneCount = laneTotals.get(laneKey) || 1;

        const showLabel = edge.label && edge.label !== 'calls';
        const label = showLabel ? makeEdgeLabel(edge.label) : null;
        if (label) {
          labelGroup.add(label);
        }

        edges.push({
          edge: edge,
          line: line,
          arrow: arrow,
          label: label,
          particle: particle,
          t: Math.random(),
          curve: null,
          laneIndex: laneIndex,
          laneCount: laneCount,
          isArchitectureMode: isArchitectureMode
        });

        const a1 = adjacency.get(edge.from) || [];
        a1.push(edges.length - 1);
        adjacency.set(edge.from, a1);
        const a2 = adjacency.get(edge.to) || [];
        a2.push(edges.length - 1);
        adjacency.set(edge.to, a2);
      }

      fitViewToGraph(positions);
    }

    function getOutAnchor(nodeId, portId) {
      const meta = nodeMeta.get(nodeId);
      if (!meta) return null;
      if (portId && meta.ports?.byId?.has(portId)) {
        const m = meta.ports.byId.get(portId);
        const p = m.position.clone();
        p.add(meta.group.position);
        p.z = 0;
        return p;
      }
      const p = meta.group.position.clone();
      p.x += (meta.w / 2) + 8;
      p.z = 0;
      return p;
    }

    function getInAnchor(nodeId, portId) {
      const meta = nodeMeta.get(nodeId);
      if (!meta) return null;
      if (portId && meta.ports?.byId?.has(portId)) {
        const m = meta.ports.byId.get(portId);
        const p = m.position.clone();
        p.add(meta.group.position);
        p.z = 0;
        return p;
      }
      const p = meta.group.position.clone();
      p.x -= (meta.w / 2) + 8;
      p.z = 0;
      return p;
    }

    function updateEdgeVisual(e) {
      const a = getOutAnchor(e.edge.from, e.edge.fromPort);
      const b = getInAnchor(e.edge.to, e.edge.toPort);
      if (!a || !b) return;

      const p1 = a.clone();
      const p2 = b.clone();
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const bend = clamp(Math.abs(dx) * 0.25, 40, 180);
      const laneShift = ((e.laneIndex || 0) - ((e.laneCount || 1) - 1) / 2) * 18;
      const mid = new THREE.Vector3(p1.x + dx * 0.5, p1.y + dy * 0.5, 0);
      mid.y += (dy >= 0 ? 1 : -1) * Math.min(140, bend * 0.3) + laneShift;

      const curve = new THREE.QuadraticBezierCurve3(p1, mid, p2);
      e.curve = curve;
      const pts = curve.getPoints(24);
      e.line.geometry.setFromPoints(pts);

      // Arrowhead at end.
      const t2 = 0.98;
      const end = curve.getPointAt(t2);
      const prev = curve.getPointAt(0.96);
      const dir = end.clone().sub(prev).normalize();
      e.arrow.position.copy(end);
      e.arrow.rotation.z = Math.atan2(dir.y, dir.x) - Math.PI / 2;

      // Particle animation.
      const pos = curve.getPointAt(e.t);
      e.particle.position.copy(pos);

      // Edge label.
      if (e.label) {
        const midp = curve.getPointAt(0.5);
        e.label.position.set(midp.x, midp.y + 14 + laneShift * 0.25, 0);
      }
    }

    function setDetails(node) {
      if (!node) {
        details.textContent = 'None';
        return;
      }
      const idxs = adjacency.get(node.id) || [];
      const lines = [];
      const collapseKey = getCollapseKeyForNode(node);
      const isCollapsed = collapseKey ? collapsedLayers.has(collapseKey) : false;
      for (let i = 0; i < Math.min(18, idxs.length); i++) {
        const e = edges[idxs[i]];
        if (!e) continue;
        const dir = (e.edge.from === node.id) ? '->' : '<-';
        const other = (e.edge.from === node.id) ? e.edge.to : e.edge.from;
        const label = e.edge.label ? (' (' + e.edge.label + ')') : '';
        const kind = e.edge.kind ? (' [' + e.edge.kind + ']') : '';
        lines.push(dir + ' ' + other + label + kind);
      }
      details.textContent = [
        'label: ' + node.label,
        'type: ' + node.type,
        node.layer ? 'layer: ' + node.layer : null,
        collapseKey ? ('collapsed: ' + (isCollapsed ? 'yes' : 'no')) : null,
        node.detail ? 'detail: ' + node.detail : null,
        typeof node.line === 'number' ? 'line: ' + (node.line + 1) : null,
        lines.length ? ('edges:\\n' + lines.join('\\n')) : null
      ].filter(Boolean).join('\\n');
    }

    function setNodeHighlight(nodeId, enabled) {
      const meta = nodeMeta.get(nodeId);
      if (!meta) return;
      meta.body.material.emissive.setHex(enabled ? 0x1b3a77 : 0x000000);
      meta.body.material.color.setHex(enabled ? 0x172554 : 0x0f172a);
    }

    function updatePointer(ev) {
      const rect = canvas.getBoundingClientRect();
      pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -(((ev.clientY - rect.top) / rect.height) * 2 - 1);
    }

    let hoveredNodeId = null;
    let selectedNodeId = null;
    let dragging = null; // { nodeId, startX, startY, moved }

    // Hand mode (pan) like Node-RED: double-click toggles.
    let handMode = false;
    let panning = null; // { startX, startY, camX, camY, targetX, targetY }

    function setCursor() {
      if (panning) {
        canvas.style.cursor = 'grabbing';
        return;
      }
      if (handMode) {
        canvas.style.cursor = 'grab';
        return;
      }
      canvas.style.cursor = '';
    }

    function toggleHandMode() {
      handMode = !handMode;
      setCursor();
    }

    function updateModeUi() {
      if (modeArchitectureBtn) {
        modeArchitectureBtn.classList.toggle('active', viewMode === 'architecture');
      }
      if (modeRuntimeBtn) {
        modeRuntimeBtn.classList.toggle('active', viewMode === 'runtime');
      }
      if (modeHint) {
        modeHint.textContent =
          viewMode === 'architecture'
            ? 'Architecture view: grouped by layers. Click a layer to collapse.'
            : 'Runtime view: function call/data-flow with ports and animated movement.';
      }
      if (collapseAllBtn) {
        collapseAllBtn.disabled = viewMode !== 'architecture';
      }
      if (expandAllBtn) {
        expandAllBtn.disabled = viewMode !== 'architecture';
      }
      try {
        vscode?.setState?.({ viewMode: viewMode, collapsedLayers: Array.from(collapsedLayers) });
      } catch {}
    }

    function collapseAllLayers() {
      if (viewMode !== 'architecture') {
        return;
      }
      collapsedLayers.clear();
      for (let i = 0; i < graph.nodes.length; i++) {
        const node = graph.nodes[i];
        if (node.type === 'layer') {
          const key = getCollapseKeyForNode(node);
          if (key) {
            collapsedLayers.add(key);
          }
        }
      }
      buildGraphScene(graph);
      setDetails(null);
    }

    function expandAllLayers() {
      if (viewMode !== 'architecture') {
        return;
      }
      collapsedLayers.clear();
      buildGraphScene(graph);
      setDetails(null);
    }

    function applySceneThemeByMode() {
      if (viewMode === 'architecture') {
        scene.background = new THREE.Color(0x070b18);
        if (grid.material && Array.isArray(grid.material)) {
          for (const m of grid.material) {
            m.opacity = 0.24;
            m.transparent = true;
          }
        }
      } else {
        scene.background = new THREE.Color(0x060d1c);
        if (grid.material && Array.isArray(grid.material)) {
          for (const m of grid.material) {
            m.opacity = 0.4;
            m.transparent = true;
          }
        }
      }
    }

    function setViewMode(nextMode) {
      if (nextMode !== 'architecture' && nextMode !== 'runtime') {
        return;
      }
      if (viewMode === nextMode) {
        return;
      }
      viewMode = nextMode;
      updateModeUi();
      applySceneThemeByMode();
      buildGraphScene(graph);
      setDetails(null);
    }

    function onPointerMove(ev) {
      updatePointer(ev);

      if (dragging) {
        hidePortTip();
        raycaster.setFromCamera(pointer, camera);
        if (raycaster.ray.intersectPlane(dragPlane, dragPoint)) {
          const meta = nodeMeta.get(dragging.nodeId);
          if (meta) {
            meta.group.position.x = dragPoint.x;
            meta.group.position.y = dragPoint.y;
            dragging.moved = true;
          }
        }
        return;
      }

      if (panning) {
        hidePortTip();
        const dx = ev.clientX - panning.startX;
        const dy = ev.clientY - panning.startY;

        // Convert screen delta to world units using the ortho frustum size.
        const rect = canvas.getBoundingClientRect();
        const worldPerPxX = (camera.right - camera.left) / Math.max(1, rect.width);
        const worldPerPxY = (camera.top - camera.bottom) / Math.max(1, rect.height);

        camera.position.x = panning.camX - dx * worldPerPxX;
        camera.position.y = panning.camY + dy * worldPerPxY;
        controls.target.x = panning.targetX - dx * worldPerPxX;
        controls.target.y = panning.targetY + dy * worldPerPxY;
        return;
      }
    }

    function onPointerDown(ev) {
      updatePointer(ev);

      // If clicking a port, show tooltip (no navigation).
      raycaster.setFromCamera(pointer, camera);
      const portHits = raycaster.intersectObjects(portMeshes, false);
      const phit = portHits[0] && portHits[0].object ? portHits[0].object : null;
      if (phit && phit.userData && phit.userData.kind === 'port') {
        const name = phit.userData.portName || '';
        const dir = phit.userData.direction || '';
        const kind = phit.userData.portKind || '';
        const det = phit.userData.portDetail || '';
        showPortTip(ev.clientX, ev.clientY, { name, dir, kind, det });
        return;
      }
      hidePortTip();

      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(nodeBodies, false);
      const hit = hits[0] && hits[0].object ? hits[0].object : null;
      if (hit && hit.userData && hit.userData.nodeId) {
        const nodeId = hit.userData.nodeId;
        for (let i = nodeAnimations.length - 1; i >= 0; i--) {
          if (nodeAnimations[i].nodeId === nodeId) {
            nodeAnimations.splice(i, 1);
          }
        }
        dragging = { nodeId: nodeId, moved: false };
        controls.enabled = false;
        canvas.setPointerCapture?.(ev.pointerId);
        setCursor();
        return;
      }

      // Pan background if Hand mode enabled (left mouse).
      if (handMode && ev.button === 0) {
        panning = {
          startX: ev.clientX,
          startY: ev.clientY,
          camX: camera.position.x,
          camY: camera.position.y,
          targetX: controls.target.x,
          targetY: controls.target.y
        };
        canvas.setPointerCapture?.(ev.pointerId);
        setCursor();
      }
    }

    function onPointerUp() {
      controls.enabled = true;
      if (dragging) {
        const nodeId = dragging.nodeId;
        const didMove = dragging.moved;
        const meta = nodeMeta.get(nodeId);
        dragging = null;

        // Treat a non-move pointer up as a click selection.
        if (!didMove) {
          selectedNodeId = nodeId;
          const node = nodeMeta.get(nodeId)?.node;
          if (node && viewMode === 'architecture' && node.type === 'layer') {
            const collapseKey = getCollapseKeyForNode(node);
            if (collapseKey) {
              if (collapsedLayers.has(collapseKey)) {
                collapsedLayers.delete(collapseKey);
              } else {
                collapsedLayers.add(collapseKey);
              }
              buildGraphScene(graph);
            }
            setDetails(node);
          } else {
            setDetails(node);
          }
          if (node && vscode && (node.type === 'function' || node.type === 'sink')) {
            vscode.postMessage({ type: 'navigate', node: node });
          }
        } else if (meta) {
          manualNodePositions.set(nodeId, meta.group.position.clone());
          for (let i = nodeAnimations.length - 1; i >= 0; i--) {
            if (nodeAnimations[i].nodeId === nodeId) {
              nodeAnimations.splice(i, 1);
            }
          }
        }
      }
      if (panning) {
        panning = null;
        setCursor();
      }
    }

    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup', onPointerUp);
    modeArchitectureBtn?.addEventListener('click', () => setViewMode('architecture'));
    modeRuntimeBtn?.addEventListener('click', () => setViewMode('runtime'));
    collapseAllBtn?.addEventListener('click', collapseAllLayers);
    expandAllBtn?.addEventListener('click', expandAllLayers);
    canvas.addEventListener('dblclick', (ev) => {
      // Only toggle when double-clicking on background (not on a node).
      updatePointer(ev);
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(nodeBodies, false);
      if (hits && hits.length) {
        return;
      }
      toggleHandMode();
    });
    window.addEventListener('resize', resize);

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg && msg.type === 'graph') {
        graph = msg.graph;
        buildGraphScene(graph);
      }
    });

    function resize() {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const aspect = w / Math.max(1, h);
      const viewHeight = 520;
      const viewWidth = viewHeight * aspect;
      camera.left = -viewWidth / 2;
      camera.right = viewWidth / 2;
      camera.top = viewHeight / 2;
      camera.bottom = -viewHeight / 2;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
      setCursor();
    }

    function showPortTip(x, y, info) {
      if (!portTip) return;
      // Build DOM instead of using innerHTML to avoid HTML-parser edge cases in webviews.
      portTip.textContent = '';

      const addRow = (label, value) => {
        const row = document.createElement('div');
        const k = document.createElement('span');
        k.className = 'k';
        k.textContent = label + ': ';
        const v = document.createElement('span');
        v.className = 'v';
        v.textContent = String(value ?? '');
        row.appendChild(k);
        row.appendChild(v);
        portTip.appendChild(row);
      };

      addRow('Port', info.name);
      addRow('Direction', info.dir);
      addRow('Kind', info.kind);

      if (info.det) {
        const detDiv = document.createElement('div');
        detDiv.className = 'k';
        detDiv.style.marginTop = '6px';
        detDiv.textContent = String(info.det);
        portTip.appendChild(detDiv);
      }
      const pad = 14;
      portTip.style.left = Math.max(pad, x + 12) + 'px';
      portTip.style.top = Math.max(pad, y + 12) + 'px';
      portTip.classList.add('show');
    }

    function hidePortTip() {
      if (!portTip) return;
      portTip.classList.remove('show');
    }

    // No HTML escaping needed because we use textContent for tooltip content.

    function animate(nowMs) {
      requestAnimationFrame(animate);
      const dt = lastFrameAt ? Math.min(0.05, (nowMs - lastFrameAt) / 1000) : 0.016;
      lastFrameAt = nowMs;
      controls.update();

      // Smooth camera transitions after mode/layout changes.
      if (cameraAnim.active && !dragging && !panning) {
        const camLerp = 0.14;
        camera.position.x += (cameraAnim.x - camera.position.x) * camLerp;
        camera.position.y += (cameraAnim.y - camera.position.y) * camLerp;
        controls.target.x += (cameraAnim.x - controls.target.x) * camLerp;
        controls.target.y += (cameraAnim.y - controls.target.y) * camLerp;
        camera.zoom += (cameraAnim.zoom - camera.zoom) * camLerp;
        camera.updateProjectionMatrix();
        if (
          Math.abs(camera.position.x - cameraAnim.x) < 0.8 &&
          Math.abs(camera.position.y - cameraAnim.y) < 0.8 &&
          Math.abs(camera.zoom - cameraAnim.zoom) < 0.002
        ) {
          cameraAnim.active = false;
        }
      }

      // Smooth node transitions for expand/collapse and relayout.
      for (let i = 0; i < nodeAnimations.length; i++) {
        const anim = nodeAnimations[i];
        if (!anim || !anim.group) {
          continue;
        }
        if (anim.delay > 0) {
          anim.delay = Math.max(0, anim.delay - dt);
          continue;
        }
        anim.group.position.lerp(anim.target, 0.2);
        const s = anim.group.scale.x + (anim.targetScale - anim.group.scale.x) * 0.2;
        anim.group.scale.setScalar(s);
        if (
          anim.delay <= 0 &&
          anim.group.position.distanceTo(anim.target) < 0.6 &&
          Math.abs(anim.group.scale.x - anim.targetScale) < 0.01
        ) {
          anim.group.position.copy(anim.target);
          anim.group.scale.setScalar(anim.targetScale);
          nodeAnimations.splice(i, 1);
          i--;
        }
      }

      // Hover detection (only when not dragging).
      if (!dragging) {
        raycaster.setFromCamera(pointer, camera);
        const hits = raycaster.intersectObjects(nodeBodies, false);
        const next = hits[0] && hits[0].object ? hits[0].object : null;
        const nextId = next && next.userData ? next.userData.nodeId : null;
        if (nextId !== hoveredNodeId) {
          if (hoveredNodeId) setNodeHighlight(hoveredNodeId, false);
          hoveredNodeId = nextId;
          if (hoveredNodeId) setNodeHighlight(hoveredNodeId, true);
        }
      }

      // Edge styling: dim by default, highlight connected edges on hover.
      for (let i = 0; i < edges.length; i++) {
        const e = edges[i];
        const baseColor = e.edge.kind === 'architecture' ? 0x818cf8 : 0x3b82f6;
        const baseOpacity = e.edge.kind === 'architecture' ? 0.34 : 0.22;
        e.line.material.opacity = baseOpacity;
        e.line.material.color.setHex(baseColor);
        e.arrow.material.opacity = e.isArchitectureMode ? 0 : 0.35;
        e.arrow.material.color.setHex(baseColor);
      }
      if (hoveredNodeId) {
        const idxs = adjacency.get(hoveredNodeId) || [];
        for (let i = 0; i < idxs.length; i++) {
          const e = edges[idxs[i]];
          if (!e) continue;
          e.line.material.opacity = e.edge.kind === 'architecture' ? 0.62 : 0.78;
          e.line.material.color.setHex(0x22c55e);
          e.arrow.material.opacity = e.isArchitectureMode ? 0 : 0.65;
          e.arrow.material.color.setHex(0x22c55e);
        }
      }

      // Animate particles and update edge geometry (supports drag).
      for (let i = 0; i < edges.length; i++) {
        const e = edges[i];
        if (!e.isArchitectureMode) {
          e.t = (e.t + 0.004) % 1;
        }
        updateEdgeVisual(e);
      }

      renderer.render(scene, camera);
    }

    resize();
    updateModeUi();
    applySceneThemeByMode();
    buildGraphScene(graph);
    animate();
  </script>
</body>
</html>`;
	}
}

function getNonce(): string {
	let text = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}

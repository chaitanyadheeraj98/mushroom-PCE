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
    #details { white-space: pre-wrap; font-family: Consolas, monospace; font-size: 12px; color: #cbd5e1; }
    #canvas { display: block; width: 100%; height: 100%; }
  </style>
</head>
<body>
  <div id="hud">
    <div class="card">
      <div class="title">Circuit Mode</div>
      <div class="muted">Double-click to toggle Hand mode (pan). Drag nodes to rearrange. Scroll to zoom.</div>
    </div>
    <div class="card" style="max-width: 520px;">
      <div class="title">Selection</div>
      <div id="details" class="muted">None</div>
    </div>
  </div>
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

    let graph = ${graphJson};

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

    const palette = {
      function: 0x60a5fa,
      variable: 0xfacc15,
      import: 0xa78bfa,
      decision: 0x22c55e,
      source: 0x38bdf8,
      sink: 0xf97316
    };

    const nodeBodies = []; // array of meshes used for raycast
    const nodeByMeshUuid = new Map(); // mesh.uuid -> node
    const nodeMeta = new Map(); // node.id -> { group, body, w, h, node }
    const adjacency = new Map(); // nodeId -> edge indices
    const edges = []; // { edge, line, arrow, label, curve, particle, t }

    function clearSceneGroups() {
      for (const g of [nodeGroup, edgeGroup, labelGroup, particleGroup]) {
        while (g.children.length) g.remove(g.children[0]);
      }
      nodeBodies.length = 0;
      nodeByMeshUuid.clear();
      nodeMeta.clear();
      adjacency.clear();
      edges.length = 0;
    }

    function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

    function makeLabelSprite(text, colorHex) {
      const padX = 14;
      const padY = 8;
      const font = '600 14px Segoe UI, Tahoma, sans-serif';

      const canvasEl = document.createElement('canvas');
      const ctx = canvasEl.getContext('2d');
      ctx.font = font;
      const metrics = ctx.measureText(text);
      const w = Math.ceil(metrics.width + padX * 2);
      const h = 26 + padY;
      canvasEl.width = clamp(w, 120, 320);
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

    function roundRect(ctx, x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }

    function layoutNodes(nodes) {
      const byType = new Map();
      for (const n of nodes) {
        const arr = byType.get(n.type) || [];
        arr.push(n);
        byType.set(n.type, arr);
      }
      const lanes = ['source', 'import', 'variable', 'function', 'decision', 'sink'];
      const positions = new Map();
      for (let li = 0; li < lanes.length; li++) {
        const type = lanes[li];
        const lane = byType.get(type) || [];
        const x = (li - (lanes.length - 1) / 2) * 280;
        for (let i = 0; i < lane.length; i++) {
          const y = (-(i - (lane.length - 1) / 2)) * 90;
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

    function buildGraphScene(g) {
      clearSceneGroups();

      // Precompute counts for ports.
      const inCount = new Map();
      const outCount = new Map();
      for (const e of g.edges) {
        outCount.set(e.from, (outCount.get(e.from) || 0) + 1);
        inCount.set(e.to, (inCount.get(e.to) || 0) + 1);
      }

      const positions = layoutNodes(g.nodes);

      const portGeom = new THREE.SphereGeometry(5.2, 14, 14);
      const bodyGeom = new THREE.BoxGeometry(180, 54, 8);
      const headerGeom = new THREE.BoxGeometry(180, 16, 9);
      const iconGeom = new THREE.BoxGeometry(26, 26, 10);

      for (const node of g.nodes) {
        const color = palette[node.type] || 0x94a3b8;
        const labelText = node.label;
        const w = clamp(110 + labelText.length * 7, 160, 320);
        const h = 54;

        const group = new THREE.Group();
        group.position.copy(positions.get(node.id));
        group.userData.kind = 'nodeGroup';

        const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, 8), new THREE.MeshStandardMaterial({
          color: 0x0f172a,
          roughness: 0.85,
          metalness: 0.05,
          emissive: 0x000000
        }));
        body.userData.kind = 'nodeBody';
        body.userData.nodeId = node.id;

        const header = new THREE.Mesh(new THREE.BoxGeometry(w, 16, 9), new THREE.MeshStandardMaterial({
          color: 0x111c35,
          roughness: 0.9,
          metalness: 0.05,
          emissive: 0x000000
        }));
        header.position.set(0, (h / 2) - 8, 0.6);

        const icon = new THREE.Mesh(iconGeom, new THREE.MeshStandardMaterial({
          color: color,
          roughness: 0.35,
          metalness: 0.08,
          emissive: 0x000000
        }));
        icon.position.set((-w / 2) + 18, 0, 0.8);

        const label = makeLabelSprite(labelText);
        label.position.set((-w / 2) + 42 + Math.min(130, label.scale.x * 0.15), 0, 6.5);

        const inputs = inCount.get(node.id) || 0;
        const outputs = outCount.get(node.id) || 0;
        const ports = { in: [], out: [] };

        const makePort = (x, y, isOut) => {
          const mat = new THREE.MeshBasicMaterial({ color: isOut ? 0x93c5fd : 0x94a3b8 });
          const p = new THREE.Mesh(portGeom, mat);
          p.position.set(x, y, 4.5);
          p.userData.kind = 'port';
          return p;
        };

        // Distribute ports along left/right edge.
        const portSpan = h - 18;
        const portStart = (h / 2) - 9;
        for (let i = 0; i < inputs; i++) {
          const t = (inputs === 1) ? 0.5 : (i / (inputs - 1));
          const y = portStart - t * portSpan;
          const p = makePort((-w / 2) - 4, y, false);
          ports.in.push(p);
          group.add(p);
        }
        for (let i = 0; i < outputs; i++) {
          const t = (outputs === 1) ? 0.5 : (i / (outputs - 1));
          const y = portStart - t * portSpan;
          const p = makePort((w / 2) + 4, y, true);
          ports.out.push(p);
          group.add(p);
        }

        group.add(body, header, icon, label);
        nodeGroup.add(group);
        nodeBodies.push(body);
        nodeByMeshUuid.set(body.uuid, node);
        nodeMeta.set(node.id, { group: group, body: body, w: w, h: h, ports: ports, node: node });
      }

      // Create edges (line + arrow + label + particle). Geometry is updated every frame in case nodes move.
      for (let ei = 0; ei < g.edges.length; ei++) {
        const edge = g.edges[ei];
        const lineGeom = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
        const lineMat = new THREE.LineBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.28 });
        const line = new THREE.Line(lineGeom, lineMat);
        edgeGroup.add(line);

        const arrow = new THREE.Mesh(
          new THREE.ConeGeometry(6.2, 16, 14),
          new THREE.MeshBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.55 })
        );
        arrow.rotation.z = Math.PI / 2;
        particleGroup.add(arrow);

        const particle = new THREE.Mesh(new THREE.SphereGeometry(4.0, 12, 12), new THREE.MeshBasicMaterial({ color: 0x22c55e }));
        particleGroup.add(particle);

        const label = edge.label ? makeEdgeLabel(edge.label) : null;
        if (label) {
          labelGroup.add(label);
        }

        edges.push({ edge: edge, line: line, arrow: arrow, label: label, particle: particle, t: Math.random(), curve: null });

        const a1 = adjacency.get(edge.from) || [];
        a1.push(edges.length - 1);
        adjacency.set(edge.from, a1);
        const a2 = adjacency.get(edge.to) || [];
        a2.push(edges.length - 1);
        adjacency.set(edge.to, a2);
      }

      // Fit view roughly around the layout.
      controls.target.set(0, 0, 0);
      controls.update();
    }

    function getOutAnchor(nodeId) {
      const meta = nodeMeta.get(nodeId);
      if (!meta) return null;
      const p = meta.group.position.clone();
      p.x += (meta.w / 2) + 8;
      p.z = 0;
      return p;
    }

    function getInAnchor(nodeId) {
      const meta = nodeMeta.get(nodeId);
      if (!meta) return null;
      const p = meta.group.position.clone();
      p.x -= (meta.w / 2) + 8;
      p.z = 0;
      return p;
    }

    function updateEdgeVisual(e) {
      const a = getOutAnchor(e.edge.from);
      const b = getInAnchor(e.edge.to);
      if (!a || !b) return;

      const p1 = a.clone();
      const p2 = b.clone();
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const bend = clamp(Math.abs(dx) * 0.25, 40, 180);
      const mid = new THREE.Vector3(p1.x + dx * 0.5, p1.y + dy * 0.5, 0);
      mid.y += (dy >= 0 ? 1 : -1) * Math.min(140, bend * 0.3);

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
        e.label.position.set(midp.x, midp.y + 14, 0);
      }
    }

    function setDetails(node) {
      if (!node) {
        details.textContent = 'None';
        return;
      }
      const idxs = adjacency.get(node.id) || [];
      const lines = [];
      for (let i = 0; i < Math.min(18, idxs.length); i++) {
        const e = edges[idxs[i]];
        if (!e) continue;
        const dir = (e.edge.from === node.id) ? '->' : '<-';
        const other = (e.edge.from === node.id) ? e.edge.to : e.edge.from;
        const label = e.edge.label ? (' (' + e.edge.label + ')') : '';
        lines.push(dir + ' ' + other + label);
      }
      details.textContent = [
        'label: ' + node.label,
        'type: ' + node.type,
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

    function onPointerMove(ev) {
      updatePointer(ev);

      if (dragging) {
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

      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(nodeBodies, false);
      const hit = hits[0] && hits[0].object ? hits[0].object : null;
      if (hit && hit.userData && hit.userData.nodeId) {
        const nodeId = hit.userData.nodeId;
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
        dragging = null;

        // Treat a non-move pointer up as a click selection.
        if (!didMove) {
          selectedNodeId = nodeId;
          const node = nodeMeta.get(nodeId)?.node;
          setDetails(node);
          if (node && vscode) {
            vscode.postMessage({ type: 'navigate', node: node });
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

    function animate() {
      requestAnimationFrame(animate);
      controls.update();

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
        e.line.material.opacity = 0.22;
        e.line.material.color.setHex(0x3b82f6);
        e.arrow.material.opacity = 0.35;
        e.arrow.material.color.setHex(0x3b82f6);
      }
      if (hoveredNodeId) {
        const idxs = adjacency.get(hoveredNodeId) || [];
        for (let i = 0; i < idxs.length; i++) {
          const e = edges[idxs[i]];
          if (!e) continue;
          e.line.material.opacity = 0.78;
          e.line.material.color.setHex(0x22c55e);
          e.arrow.material.opacity = 0.65;
          e.arrow.material.color.setHex(0x22c55e);
        }
      }

      // Animate particles and update edge geometry (supports drag).
      for (let i = 0; i < edges.length; i++) {
        const e = edges[i];
        e.t = (e.t + 0.004) % 1;
        updateEdgeVisual(e);
      }

      renderer.render(scene, camera);
    }

    resize();
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

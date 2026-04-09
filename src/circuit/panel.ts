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
		const orbitUri = webview.asWebviewUri(
			vscode.Uri.joinPath(extensionUri, 'node_modules', 'three', 'examples', 'jsm', 'controls', 'OrbitControls.js')
		);

		return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} data:; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${cspSource};">
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Circuit Mode</title>
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
      <div class="muted">Hover to highlight. Click for details. Scroll to zoom. Drag to orbit.</div>
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
      THREE = await import('${threeUri}');
      ({ OrbitControls } = await import('${orbitUri}'));
    } catch (err) {
      const details = document.getElementById('details');
      details.textContent = 'Failed to load Three.js.\\n' + (err?.message ?? String(err));
      throw err;
    }

    const vscode = (typeof acquireVsCodeApi === 'function') ? acquireVsCodeApi() : undefined;
    const canvas = document.getElementById('canvas');
    const details = document.getElementById('details');

    let graph = ${graphJson};

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x070b18);

    const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 2000);
    camera.position.set(0, 60, 160);

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;

    const light = new THREE.DirectionalLight(0xffffff, 1.2);
    light.position.set(100, 140, 80);
    scene.add(light);
    scene.add(new THREE.AmbientLight(0x90a4ff, 0.25));

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let hovered = null;
    let selected = null;

    const nodeGroup = new THREE.Group();
    const edgeGroup = new THREE.Group();
    const particleGroup = new THREE.Group();
    scene.add(edgeGroup, particleGroup, nodeGroup);

    const palette = {
      function: 0x60a5fa,
      variable: 0xfacc15,
      import: 0xa78bfa,
      decision: 0x22c55e,
      source: 0x38bdf8,
      sink: 0xf97316
    };

    const nodeMeshes = new Map(); // id -> mesh
    const nodeData = new Map(); // mesh.uuid -> node
    const edgeLines = []; // { line, from, to, label }
    const particles = []; // { mesh, path, t }
    const adjacency = new Map(); // nodeId -> edge indices

    function clearSceneGroups() {
      for (const g of [nodeGroup, edgeGroup, particleGroup]) {
        while (g.children.length) g.remove(g.children[0]);
      }
      nodeMeshes.clear();
      nodeData.clear();
      edgeLines.length = 0;
      particles.length = 0;
    }

    function layoutNodes(nodes) {
      // Simple layered layout: imports -> variables -> functions -> decisions
      const byType = new Map();
      for (const n of nodes) {
        const arr = byType.get(n.type) || [];
        arr.push(n);
        byType.set(n.type, arr);
      }
      const lanes = ['import', 'variable', 'function', 'decision', 'source', 'sink'];
      const positions = new Map();
      for (let li = 0; li < lanes.length; li++) {
        const type = lanes[li];
        const lane = byType.get(type) || [];
        const x = (li - (lanes.length - 1) / 2) * 55;
        for (let i = 0; i < lane.length; i++) {
          const y = 0;
          const z = (i - (lane.length - 1) / 2) * 16;
          positions.set(lane[i].id, new THREE.Vector3(x, y, z));
        }
      }
      // Any unknown type goes to the end.
      for (const n of nodes) {
        if (!positions.has(n.id)) {
          positions.set(n.id, new THREE.Vector3(0, 0, 0));
        }
      }
      return positions;
    }

    function buildGraphScene(g) {
      clearSceneGroups();
      adjacency.clear();

      const positions = layoutNodes(g.nodes);

      const nodeGeom = new THREE.IcosahedronGeometry(5.5, 1);
      const outlineGeom = new THREE.IcosahedronGeometry(6.6, 1);

      for (const node of g.nodes) {
        const color = palette[node.type] ?? 0x94a3b8;
        const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.15 });
        const mesh = new THREE.Mesh(nodeGeom, mat);
        mesh.position.copy(positions.get(node.id));
        mesh.userData.kind = 'node';

        const outline = new THREE.Mesh(outlineGeom, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.08 }));
        outline.position.copy(mesh.position);
        outline.userData.kind = 'outline';

        nodeGroup.add(outline, mesh);
        nodeMeshes.set(node.id, mesh);
        nodeData.set(mesh.uuid, node);
      }

      for (const edge of g.edges) {
        const from = nodeMeshes.get(edge.from);
        const to = nodeMeshes.get(edge.to);
        if (!from || !to) continue;

        const p1 = from.position.clone();
        const p2 = to.position.clone();
        const mid = p1.clone().lerp(p2, 0.5);
        mid.y += Math.min(22, Math.max(6, p1.distanceTo(p2) * 0.12));

        const curve = new THREE.QuadraticBezierCurve3(p1, mid, p2);
        const points = curve.getPoints(32);
        const geom = new THREE.BufferGeometry().setFromPoints(points);
        const mat = new THREE.LineBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.55 });
        const line = new THREE.Line(geom, mat);
        line.userData.kind = 'edge';
        edgeGroup.add(line);
        edgeLines.push({ line, edge, curve });

        const a1 = adjacency.get(edge.from) || [];
        a1.push(edgeLines.length - 1);
        adjacency.set(edge.from, a1);
        const a2 = adjacency.get(edge.to) || [];
        a2.push(edgeLines.length - 1);
        adjacency.set(edge.to, a2);

        // Add a small particle to show direction.
        const particle = new THREE.Mesh(new THREE.SphereGeometry(1.2, 10, 10), new THREE.MeshBasicMaterial({ color: 0x22c55e }));
        particleGroup.add(particle);
        particles.push({ mesh: particle, curve, t: Math.random() });
      }
    }

    function setDetails(node) {
      if (!node) {
        details.textContent = 'None';
        return;
      }
      const edges = adjacency.get(node.id) || [];
      const edgeText = edges.slice(0, 16).map((idx) => {
        const e = edgeLines[idx]?.edge;
        if (!e) return null;
        const dir = (e.from === node.id) ? '->' : '<-';
        const other = (e.from === node.id) ? e.to : e.from;
        const label = e.label ? (' (' + e.label + ')') : '';
        return dir + ' ' + other + label;
      }).filter(Boolean);
      details.textContent = [
        'label: ' + node.label,
        'type: ' + node.type,
        node.detail ? 'detail: ' + node.detail : null,
        typeof node.line === 'number' ? 'line: ' + (node.line + 1) : null
        ,
        edgeText.length ? ('edges:\\n' + edgeText.join('\\n')) : null
      ].filter(Boolean).join('\\n');
    }

    function highlight(mesh, enabled) {
      if (!mesh) return;
      const mat = mesh.material;
      if (!mat || !mat.color) return;
      mesh.scale.setScalar(enabled ? 1.18 : 1.0);
      mat.emissive = mat.emissive || new THREE.Color(0x000000);
      mat.emissive.setHex(enabled ? 0x193b7a : 0x000000);
    }

    function onPointerMove(ev) {
      const rect = canvas.getBoundingClientRect();
      pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -(((ev.clientY - rect.top) / rect.height) * 2 - 1);
    }

    function onClick() {
      if (hovered) {
        selected = hovered;
        const node = nodeData.get(selected.uuid);
        setDetails(node);
        if (node && vscode) {
          vscode.postMessage({ type: 'navigate', node });
        }
      }
    }

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('click', onClick);
    window.addEventListener('resize', resize);

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg?.type === 'graph') {
        graph = msg.graph;
        buildGraphScene(graph);
      }
    });

    function resize() {
      const w = window.innerWidth;
      const h = window.innerHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
    }

    function animate() {
      requestAnimationFrame(animate);

      controls.update();

      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects([...nodeMeshes.values()], false);
      const nextHovered = hits[0]?.object ?? null;
      if (nextHovered !== hovered) {
        highlight(hovered, false);
        hovered = nextHovered;
        highlight(hovered, true);

        // Dim all edges, then highlight edges connected to hovered node.
        for (const e of edgeLines) {
          e.line.material.opacity = 0.18;
          e.line.material.color.setHex(0x3b82f6);
        }
        const node = hovered ? nodeData.get(hovered.uuid) : null;
        if (node) {
          const idxs = adjacency.get(node.id) || [];
          for (const idx of idxs) {
            const e = edgeLines[idx];
            if (e?.line?.material) {
              e.line.material.opacity = 0.75;
              e.line.material.color.setHex(0x22c55e);
            }
          }
        }
      }

      for (const p of particles) {
        p.t = (p.t + 0.006) % 1;
        const pos = p.curve.getPointAt(p.t);
        p.mesh.position.copy(pos);
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

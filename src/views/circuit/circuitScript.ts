export function buildCircuitWebviewScript(
	graphJson: string,
	initialSkeletonRootNodeIdJson: string,
	initialViewModeJson: string,
	initialGraphifyContextEnabledJson: string
): string {
	return `
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
    const nodeMenu = document.getElementById('nodeMenu');
    const fabWrap = document.getElementById('fabWrap');
    const fabAdd = document.getElementById('fabAdd');
    const fabMenu = document.getElementById('fabMenu');
    const addContextBotBtn = document.getElementById('addContextBotBtn');
    const modeArchitectureBtn = document.getElementById('modeArchitecture');
    const modeRuntimeBtn = document.getElementById('modeRuntime');
    const collapseAllBtn = document.getElementById('collapseAllBtn');
    const expandAllBtn = document.getElementById('expandAllBtn');
    const fullArchitectureBtn = document.getElementById('fullArchitectureBtn');
    const currentFileBtn = document.getElementById('currentFileBtn');
    const codeFlowBtn = document.getElementById('codeFlowBtn');
    const depImportsBtn = document.getElementById('depImportsBtn');
    const depImportsCallsBtn = document.getElementById('depImportsCallsBtn');
    const edgeFilterBtn = document.getElementById('edgeFilterBtn');
    const aiEnrichBtn = document.getElementById('aiEnrichBtn');
    const aiApplyAllBtn = document.getElementById('aiApplyAllBtn');
    const aiRejectAllBtn = document.getElementById('aiRejectAllBtn');
    const relationStateEl = document.getElementById('relationState');
    const relationChatDrawer = document.getElementById('relationChatDrawer');
    const relationChatHeader = document.getElementById('relationChatHeader');
    const relationChatBody = document.getElementById('relationChatBody');
    const relationChatTimeline = document.getElementById('relationChatTimeline');
    const relationChatToggleBtn = document.getElementById('relationChatToggleBtn');
    const relationChatInput = document.getElementById('relationChatInput');
    const includeExternalBtn = document.getElementById('includeExternalBtn');
    const disconnectContextBtn = document.getElementById('disconnectContextBtn');
    const modeHint = document.getElementById('modeHint');
    const graphifyContextIndicator = document.getElementById('graphifyContextIndicator');
    const viewLockBtn = document.getElementById('viewLockBtn');
    const hudMinBtn = document.getElementById('hudMinBtn');
    const hudMaxBtn = document.getElementById('hudMaxBtn');

    let graph = ${graphJson};
    const initialViewMode = ${initialViewModeJson};
    let viewMode = (initialViewMode === 'architecture' || initialViewMode === 'runtime') ? initialViewMode : 'architecture'; // architecture | runtime
    const collapsedLayers = new Set();
    let skeletonRootNodeId = ${initialSkeletonRootNodeIdJson};
    let skeletonNodeIds = null; // Set<string> | null
    let edgeFilterMode = 'all'; // 'all' | 'api-high'
    let fullArchitectureDependencyMode = 'imports'; // 'imports' | 'imports-calls'
    let currentGraphScope = 'current-file'; // 'current-file' | 'full-architecture' | 'codeflow'
    let menuNodeId = null;
    let hudMinimized = false;
    let hudMaximized = false;
    let viewLocked = false;
    let aiNodeSummaryMap = new Map();
    let aiSuggestedEdgesPending = [];
    let relationFromNodeId = null;
    let relationToNodeId = null;
    let relationChatCollapsed = false;
    let relationChatDraft = '';
    const relationChatMessages = [];
    let graphifyContextEnabled = ${initialGraphifyContextEnabledJson};

    try {
      const saved = vscode?.getState?.();
      if (!initialViewMode && saved && (saved.viewMode === 'architecture' || saved.viewMode === 'runtime')) {
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
      if (saved && (saved.edgeFilterMode === 'all' || saved.edgeFilterMode === 'api-high')) {
        edgeFilterMode = saved.edgeFilterMode;
      }
      if (saved && (saved.fullArchitectureDependencyMode === 'imports' || saved.fullArchitectureDependencyMode === 'imports-calls')) {
        fullArchitectureDependencyMode = saved.fullArchitectureDependencyMode;
      }
      if (saved && (saved.currentGraphScope === 'current-file' || saved.currentGraphScope === 'full-architecture' || saved.currentGraphScope === 'codeflow')) {
        currentGraphScope = saved.currentGraphScope;
      }
      hudMinimized = !!saved?.hudMinimized;
      hudMaximized = !!saved?.hudMaximized;
      viewLocked = !!saved?.viewLocked;
      relationChatCollapsed = !!saved?.relationChatCollapsed;
      relationFromNodeId = typeof saved?.relationFromNodeId === 'string' ? saved.relationFromNodeId : null;
      relationToNodeId = typeof saved?.relationToNodeId === 'string' ? saved.relationToNodeId : null;
      relationChatDraft = typeof saved?.relationChatDraft === 'string' ? saved.relationChatDraft : '';
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
    controls.zoomSpeed = 1.05;
    controls.minZoom = 0.22;
    controls.maxZoom = 3.2;
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

    const NODE_W = 248;
    const NODE_H = 74;
    const NODE_HEADER_H = 16;
    const NODE_ICON_W = 12;
    const NODE_ICON_H = 12;
    const NODE_BODY_COLOR = 0x1b1f26;
    const NODE_HEADER_COLOR = 0x2b313c;
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
      in: 0x8b5cf6,   // violet
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
    let activePortMesh = null;
    const connectPreview = {
      active: false,
      fromNodeId: null,
      fromPortId: null,
      fromPoint: new THREE.Vector3(),
      toPoint: new THREE.Vector3(),
      snapped: false,
      snapPortId: null,
      line: null
    };
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
      connectPreview.line = null;
      activePortMesh = null;
    }

    function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

    function setPortGlow(mesh, enabled) {
      if (!mesh || !mesh.material) return;
      const mat = mesh.material;
      const dir = String(mesh.userData?.direction || '');
      const base = dir === 'out' ? portColors.out : portColors.in;
      const emissiveBase = dir === 'out' ? 0x166534 : 0x4c1d95;
      if (enabled) {
        mat.color.setHex(base);
        mat.emissive.setHex(base);
        mat.emissiveIntensity = 1.15;
      } else {
        mat.color.setHex(base);
        mat.emissive.setHex(emissiveBase);
        mat.emissiveIntensity = 0.26;
      }
    }

    function setActivePort(mesh) {
      if (activePortMesh && activePortMesh !== mesh) {
        setPortGlow(activePortMesh, false);
      }
      activePortMesh = mesh || null;
      if (activePortMesh) {
        setPortGlow(activePortMesh, true);
      }
    }

    function fitLabel(text, maxChars) {
      if (!text || text.length <= maxChars) return text;
      return text.slice(0, Math.max(0, maxChars - 1)) + '...';
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

    function makeEdgeLabel(text, accentHex) {
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
      const accentColor = (typeof accentHex === 'number') ? ('#' + accentHex.toString(16).padStart(6, '0')) : '#3b82f6';
      ctx.strokeStyle = accentColor;
      ctx.lineWidth = 1;
      roundRect(ctx, 0.5, 0.5, w - 1, h - 1, 8);
      ctx.stroke();
      ctx.fillStyle = '#e2e8f0';
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

    function makeTinyLabelSprite(text, fgHex = '#a9b4c9') {
      const canvasEl = document.createElement('canvas');
      const ctx = canvasEl.getContext('2d');
      const font = '600 10px Segoe UI, Tahoma, sans-serif';
      ctx.font = font;
      const metrics = ctx.measureText(text);
      const w = clamp(Math.ceil(metrics.width + 8), 22, 120);
      const h = 16;
      canvasEl.width = w;
      canvasEl.height = h;
      ctx.font = font;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = fgHex;
      ctx.textBaseline = 'middle';
      ctx.fillText(text, 4, h / 2);

      const tex = new THREE.CanvasTexture(canvasEl);
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
      const spr = new THREE.Sprite(mat);
      spr.scale.set(w * 0.48, h * 0.48, 1);
      spr.userData.kind = 'tinyLabel';
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

    function getVisibleGraph(g, skeletonOverride = undefined) {
      const activeSkeleton = skeletonOverride === undefined ? skeletonNodeIds : skeletonOverride;
      const visibleNodes = [];
      const allowedNodeIds = new Set();
      for (let i = 0; i < g.nodes.length; i++) {
        const node = g.nodes[i];
        const includeInArchitecture = node.type !== 'sink';
        const includeInRuntime =
          node.type === 'function' || node.type === 'sink' || node.type === 'module' || node.type === 'utility';
        const layerCollapsed = viewMode === 'architecture' && node.type !== 'layer' && node.layer && collapsedLayers.has(node.layer);
        const inSkeleton = !activeSkeleton || activeSkeleton.has(node.id);
        const shouldInclude =
          (viewMode === 'architecture' ? includeInArchitecture : includeInRuntime) &&
          !layerCollapsed &&
          inSkeleton;
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
        if (edgeFilterMode === 'api-high' && !edgeIsApiHigh(edge)) continue;
        if (!allowedNodeIds.has(edge.from) || !allowedNodeIds.has(edge.to)) continue;
        visibleEdges.push(edge);
      }
      return { nodes: visibleNodes, edges: visibleEdges };
    }

    function edgeIsApiHigh(edge) {
      return String(edge?.label || '').toLowerCase().includes('[api-high]');
    }

    function getEdgeTheme(edge) {
      const label = String(edge?.label || '').toLowerCase();
      if (label.includes('[ai-suggested]')) {
        return {
          baseColor: 0xf59e0b,
          focusColor: 0xfbbf24,
          baseOpacity: edge.kind === 'architecture' ? 0.68 : 0.6,
          dashed: true
        };
      }
      if (label.includes('imports')) {
        return {
          baseColor: 0xa78bfa,
          focusColor: 0xc084fc,
          baseOpacity: edge.kind === 'architecture' ? 0.5 : 0.4
        };
      }
      if (label.includes('calls')) {
        return {
          baseColor: 0x60a5fa,
          focusColor: 0x38bdf8,
          baseOpacity: edge.kind === 'architecture' ? 0.5 : 0.42
        };
      }
      return {
        baseColor: edge.kind === 'architecture' ? 0x98a2b3 : 0xb8c2d0,
        focusColor: 0x22c55e,
        baseOpacity: edge.kind === 'architecture' ? 0.42 : 0.34
      };
    }

    function isCodeFlowEdge(edge) {
      return String(edge?.label || '').toLowerCase().includes('[codeflow]');
    }

    function isCodeFlowGraph(g) {
      for (let i = 0; i < g.edges.length; i++) {
        if (isCodeFlowEdge(g.edges[i])) {
          return true;
        }
      }
      return false;
    }

    function getNextCodeFlowNodeId(nodeId) {
      const outgoing = graph.edges.filter((edge) => edge.from === nodeId && isCodeFlowEdge(edge));
      if (!outgoing.length) {
        return null;
      }
      const withTarget = outgoing
        .map((edge) => ({ edge, node: graph.nodes.find((item) => item.id === edge.to) }))
        .filter((item) => !!item.node);
      if (!withTarget.length) {
        return null;
      }
      withTarget.sort((a, b) => {
        const la = typeof a.node.line === 'number' ? a.node.line : Number.MAX_SAFE_INTEGER;
        const lb = typeof b.node.line === 'number' ? b.node.line : Number.MAX_SAFE_INTEGER;
        return la - lb;
      });
      return withTarget[0].node.id;
    }

    function makeEdgeId(prefix = 'e') {
      return prefix + ':' + Date.now().toString(36) + ':' + Math.random().toString(36).slice(2, 8);
    }

    function hasContextBot() {
      return graph.nodes.some((node) => node.id === contextBotId);
    }

    function getContextBotNode() {
      return graph.nodes.find((node) => node.id === contextBotId) || null;
    }

    function nodeFeedsContextBot(nodeId) {
      return graph.edges.some((edge) => edge.from === nodeId && edge.to === contextBotId && String(edge.label || '').includes('[context-bot]'));
    }

    function showFabMenu() {
      if (!fabMenu) {
        return;
      }
      fabMenu.classList.add('show');
    }

    function hideFabMenu() {
      if (!fabMenu) {
        return;
      }
      fabMenu.classList.remove('show');
    }

    function toggleFabMenu() {
      if (!fabMenu) {
        return;
      }
      if (fabMenu.classList.contains('show')) {
        hideFabMenu();
      } else {
        showFabMenu();
      }
    }

    function updateFabVisibility() {
      if (!fabWrap) {
        return;
      }
      const show = viewMode === 'runtime' && isCodeFlowGraph(graph);
      fabWrap.style.display = show ? 'block' : 'none';
      if (!show) {
        hideFabMenu();
      }
    }

    function ensureContextBotNode() {
      if (hasContextBot()) {
        return getContextBotNode();
      }
      const baseX = 540;
      const baseY = 0;
      const newNode = {
        id: contextBotId,
        type: 'utility',
        layer: 'utility',
        groupId: 'group:context',
        label: 'Context Bot',
        detail: 'context-bot | aggregates snippets from connected nodes',
        inputs: [{ id: 'in:context:multi', name: 'context in', direction: 'in', kind: 'call', detail: 'multiple node contexts' }],
        outputs: [{ id: 'out:context:answer', name: 'answer', direction: 'out', kind: 'return', detail: 'chat response' }]
      };
      graph.nodes.push(newNode);
      manualNodePositions.set(contextBotId, new THREE.Vector3(baseX, baseY, 0));
      buildGraphScene(graph);
      const meta = nodeMeta.get(contextBotId);
      if (meta) {
        meta.group.scale.setScalar(0.15);
        nodeAnimations.push({
          nodeId: contextBotId,
          group: meta.group,
          target: meta.group.position.clone(),
          targetScale: 1,
          delay: 0.02
        });
      }
      vscode?.postMessage({ type: 'updateGraph', graph });
      return newNode;
    }

    function removeContextBotNode() {
      if (!hasContextBot()) {
        return;
      }
      graph.nodes = graph.nodes.filter((node) => node.id !== contextBotId);
      graph.edges = graph.edges.filter((edge) => edge.from !== contextBotId && edge.to !== contextBotId);
      buildGraphScene(graph);
      setDetails(null);
      vscode?.postMessage({ type: 'updateGraph', graph });
      hideFabMenu();
    }

    function connectNodeToContextBot(nodeId) {
      if (nodeId === contextBotId) {
        return;
      }
      ensureContextBotNode();
      const exists = graph.edges.some((edge) => edge.from === nodeId && edge.to === contextBotId && String(edge.label || '').includes('[context-bot]'));
      if (exists) {
        const selected = nodeMeta.get(nodeId)?.node;
        if (selected) {
          selectedNodeId = nodeId;
          setDetails(selected);
        }
        return;
      }
      graph.edges.push({
        id: makeEdgeId('context'),
        kind: 'runtime',
        from: nodeId,
        to: contextBotId,
        label: 'context input [context-bot]'
      });
      buildGraphScene(graph);
      const selected = nodeMeta.get(nodeId)?.node;
      if (selected) {
        selectedNodeId = nodeId;
        setDetails(selected);
      }
      vscode?.postMessage({ type: 'updateGraph', graph });
    }

    function toggleContextConnectionForNode(nodeId) {
      if (!nodeId || nodeId === contextBotId) {
        return;
      }
      if (nodeFeedsContextBot(nodeId)) {
        disconnectNodeFromContextBot(nodeId);
      } else {
        connectNodeToContextBot(nodeId);
      }
    }

    function beginContextConnectFromPort(portHit) {
      if (!portHit || !portHit.userData) {
        return;
      }
      const nodeId = String(portHit.userData.nodeId || '');
      const portId = String(portHit.userData.portId || '');
      const dir = String(portHit.userData.direction || '');
      if (!nodeId || !portId || dir !== 'out' || nodeId === contextBotId) {
        return;
      }
      ensureContextBotNode();
      const world = portHit.position.clone();
      world.add(nodeMeta.get(nodeId)?.group?.position || new THREE.Vector3());
      world.z = 0;

      if (!connectPreview.line) {
        const geom = new THREE.BufferGeometry().setFromPoints([world.clone(), world.clone()]);
        const mat = new THREE.LineDashedMaterial({
          color: 0x22c55e,
          linewidth: 1,
          dashSize: 10,
          gapSize: 6,
          transparent: true,
          opacity: 0.9
        });
        const line = new THREE.Line(geom, mat);
        line.computeLineDistances();
        particleGroup.add(line);
        connectPreview.line = line;
      }

      connectPreview.active = true;
      connectPreview.fromNodeId = nodeId;
      connectPreview.fromPortId = portId;
      connectPreview.fromPoint.copy(world);
      connectPreview.toPoint.copy(world);
      if (connectPreview.line) {
        connectPreview.line.visible = true;
      }
      selectedNodeId = nodeId;
      const selectedNode = nodeMeta.get(nodeId)?.node;
      if (selectedNode) {
        setDetails(selectedNode);
      }
      hideNodeMenu();
    }

    function cancelContextConnect() {
      connectPreview.active = false;
      connectPreview.fromNodeId = null;
      connectPreview.fromPortId = null;
      connectPreview.snapped = false;
      connectPreview.snapPortId = null;
      if (connectPreview.line) {
        connectPreview.line.visible = false;
      }
    }

    function completeContextConnect() {
      if (!connectPreview.active || !connectPreview.fromNodeId) {
        return;
      }
      ensureContextBotNode();
      const sourceNodeId = connectPreview.fromNodeId;
      const sourcePortId = connectPreview.fromPortId;
      const targetPortId = connectPreview.snapPortId || 'in:context:multi';
      const exists = graph.edges.some((edge) =>
        edge.from === sourceNodeId &&
        edge.to === contextBotId &&
        edge.fromPort === sourcePortId &&
        edge.toPort === targetPortId &&
        String(edge.label || '').includes('[context-bot]')
      );
      if (exists) {
        graph.edges = graph.edges.filter((edge) => !(
          edge.from === sourceNodeId &&
          edge.to === contextBotId &&
          edge.fromPort === sourcePortId &&
          edge.toPort === targetPortId &&
          String(edge.label || '').includes('[context-bot]')
        ));
      } else {
        graph.edges.push({
          id: makeEdgeId('context'),
          kind: 'runtime',
          from: sourceNodeId,
          to: contextBotId,
          fromPort: sourcePortId || undefined,
          toPort: targetPortId,
          label: 'context input [context-bot]'
        });
      }
      buildGraphScene(graph);
      const selected = nodeMeta.get(sourceNodeId)?.node;
      if (selected) {
        selectedNodeId = sourceNodeId;
        setDetails(selected);
      } else {
        setDetails(null);
      }
      vscode?.postMessage({ type: 'updateGraph', graph });
      cancelContextConnect();
    }

    function disconnectNodeFromContextBot(nodeId) {
      if (!hasContextBot()) {
        return;
      }
      const before = graph.edges.length;
      graph.edges = graph.edges.filter((edge) => !(edge.from === nodeId && edge.to === contextBotId));
      if (graph.edges.length !== before) {
        buildGraphScene(graph);
        const selected = nodeMeta.get(nodeId)?.node;
        if (selected) {
          selectedNodeId = nodeId;
          setDetails(selected);
        } else {
          setDetails(null);
        }
        vscode?.postMessage({ type: 'updateGraph', graph });
      }
    }

    function layoutNodes(nodes, edges) {
      const positions = new Map();
      if (!Array.isArray(nodes) || !nodes.length) {
        return positions;
      }

      const byId = new Map(nodes.map((node) => [node.id, node]));
      const incoming = new Map();
      const outgoing = new Map();
      for (const node of nodes) {
        incoming.set(node.id, []);
        outgoing.set(node.id, []);
      }
      for (const edge of edges || []) {
        if (!byId.has(edge.from) || !byId.has(edge.to)) {
          continue;
        }
        outgoing.get(edge.from).push(edge.to);
        incoming.get(edge.to).push(edge.from);
      }

      const isCurrentFileNode = (node) =>
        node &&
        typeof node.detail === 'string' &&
        node.detail.toLowerCase().startsWith('current file:');

      const degreeOf = (nodeId) =>
        (incoming.get(nodeId)?.length || 0) + (outgoing.get(nodeId)?.length || 0);

      const currentFileCandidate = nodes.find((node) => isCurrentFileNode(node));
      const selectedCandidate = selectedNodeId && byId.has(selectedNodeId) ? byId.get(selectedNodeId) : null;
      const focalNode =
        currentFileCandidate ||
        selectedCandidate ||
        [...nodes].sort((a, b) => degreeOf(b.id) - degreeOf(a.id))[0];

      const focalId = focalNode ? focalNode.id : nodes[0].id;

      const forwardDist = new Map([[focalId, 0]]);
      const backwardDist = new Map([[focalId, 0]]);
      const visit = (sourceMap, adjacencyMap) => {
        const queue = [focalId];
        while (queue.length) {
          const current = queue.shift();
          const nextDist = (sourceMap.get(current) || 0) + 1;
          for (const nextId of adjacencyMap.get(current) || []) {
            if (sourceMap.has(nextId)) {
              continue;
            }
            sourceMap.set(nextId, nextDist);
            queue.push(nextId);
          }
        }
      };
      visit(forwardDist, outgoing);
      visit(backwardDist, incoming);

      const rankById = new Map();
      for (const node of nodes) {
        if (node.id === focalId) {
          rankById.set(node.id, 0);
          continue;
        }
        const fd = forwardDist.get(node.id);
        const bd = backwardDist.get(node.id);
        if (fd !== undefined && bd !== undefined) {
          if (fd === bd) {
            const out = outgoing.get(node.id)?.length || 0;
            const inc = incoming.get(node.id)?.length || 0;
            rankById.set(node.id, out >= inc ? Math.max(1, fd) : -Math.max(1, bd));
          } else if (fd < bd) {
            rankById.set(node.id, Math.max(1, fd));
          } else {
            rankById.set(node.id, -Math.max(1, bd));
          }
        } else if (fd !== undefined) {
          rankById.set(node.id, Math.max(1, fd));
        } else if (bd !== undefined) {
          rankById.set(node.id, -Math.max(1, bd));
        } else {
          rankById.set(node.id, 2);
        }
      }
      rankById.set(focalId, 0);

      const columns = new Map();
      for (const node of nodes) {
        const rank = rankById.get(node.id) || 0;
        const lane = columns.get(rank) || [];
        lane.push(node);
        columns.set(rank, lane);
      }

      const sortedRanks = [...columns.keys()].sort((a, b) => a - b);
      const xGap = currentGraphScope === 'full-architecture' ? 640 : 500;
      const yGap = currentGraphScope === 'full-architecture' ? 190 : 150;

      const laneSortWeight = (node) => {
        const label = String(node.label || '').toLowerCase();
        const out = outgoing.get(node.id)?.length || 0;
        const inc = incoming.get(node.id)?.length || 0;
        return (out + inc) * 1000 + label.length;
      };

      for (const rank of sortedRanks) {
        const lane = columns.get(rank) || [];
        lane.sort((a, b) => {
          if (a.id === focalId) return -1;
          if (b.id === focalId) return 1;
          const wa = laneSortWeight(a);
          const wb = laneSortWeight(b);
          if (wa !== wb) return wb - wa;
          return String(a.label || '').localeCompare(String(b.label || ''));
        });
        const laneHeight = (lane.length - 1) * yGap;
        for (let i = 0; i < lane.length; i++) {
          const x = rank * xGap;
          const y = laneHeight / 2 - i * yGap;
          positions.set(lane[i].id, new THREE.Vector3(x, y, 0));
        }
      }

      for (const node of nodes) {
        if (!positions.has(node.id)) {
          positions.set(node.id, new THREE.Vector3(0, 0, 0));
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
      const margin = 200;

      const viewW = Math.max(1, camera.right - camera.left);
      const viewH = Math.max(1, camera.top - camera.bottom);
      const zoomX = viewW / (boundsW + margin * 2);
      const zoomY = viewH / (boundsH + margin * 2);
      const nextZoom = clamp(Math.min(zoomX, zoomY), 0.22, 3.2);

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
      const visibleNodeIdSet = new Set(visibleGraph.nodes.map((node) => node.id));
      const visibleAiEdges = aiSuggestedEdgesPending
        .filter((edge) => {
          if (!visibleNodeIdSet.has(edge.from) || !visibleNodeIdSet.has(edge.to)) {
            return false;
          }
          const isArchitectureEdge = edge.kind === 'architecture';
          const includeEdge = viewMode === 'architecture' ? isArchitectureEdge : !isArchitectureEdge;
          if (!includeEdge) {
            return false;
          }
          if (edgeFilterMode === 'api-high') {
            return false;
          }
          return true;
        })
        .map((edge) => ({
          id: makeEdgeId('ai-preview'),
          kind: edge.kind === 'architecture' ? 'architecture' : 'runtime',
          from: edge.from,
          to: edge.to,
          label: (edge.label || 'suggested') + ' [ai-suggested ' + Math.round((edge.confidence || 0.5) * 100) + '%]'
        }));
      const renderEdges = [...visibleGraph.edges, ...visibleAiEdges];

      const positions = layoutNodes(visibleGraph.nodes, visibleGraph.edges);
      const laneTotals = new Map();
      const laneSeen = new Map();
      for (let i = 0; i < visibleGraph.edges.length; i++) {
        const edge = visibleGraph.edges[i];
        const key = edge.from + '=>' + edge.to;
        laneTotals.set(key, (laneTotals.get(key) || 0) + 1);
      }

      const portOuterGeom = new THREE.SphereGeometry(5.6, 14, 14);
      const portInnerGeom = new THREE.SphereGeometry(2.4, 12, 12);
      const iconGeom = new THREE.BoxGeometry(NODE_ICON_W, NODE_ICON_H, 10);

      for (const node of visibleGraph.nodes) {
        const color = layerColors[node.layer] || palette[node.type] || 0x94a3b8;
        const labelText = fitLabel(node.label, 22);
        const w = node.type === 'layer' ? NODE_W - 42 : NODE_W;
        const h = node.type === 'layer' ? NODE_H - 16 : NODE_H;
        const autoTargetPosition = positions.get(node.id);
        const pinnedPosition = manualNodePositions.get(node.id);
        const targetPosition = pinnedPosition || autoTargetPosition;

        const group = new THREE.Group();
        const previous = previousNodeState.get(node.id);
        if (previous) {
          group.position.copy(previous.position);
        } else if (pinnedPosition) {
          group.position.copy(pinnedPosition);
        } else {
          group.position.copy(targetPosition);
        }
        group.userData.kind = 'nodeGroup';

        const shadow = new THREE.Mesh(
          new THREE.BoxGeometry(w + 6, h + 6, 6),
          new THREE.MeshStandardMaterial({
            color: 0x02050b,
            roughness: 0.95,
            metalness: 0.01,
            transparent: true,
            opacity: 0.35
          })
        );
        shadow.position.set(0, -1.4, -1.8);

        const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, 8), new THREE.MeshStandardMaterial({
          color: NODE_BODY_COLOR,
          roughness: 0.72,
          metalness: 0.06,
          emissive: 0x090d13,
          emissiveIntensity: 0.2
        }));
        body.userData.kind = 'nodeBody';
        body.userData.nodeId = node.id;

        const header = new THREE.Mesh(new THREE.BoxGeometry(w, NODE_HEADER_H, 9), new THREE.MeshStandardMaterial({
          color: NODE_HEADER_COLOR,
          roughness: 0.65,
          metalness: 0.08,
          emissive: 0x111827,
          emissiveIntensity: 0.16
        }));
        header.position.set(0, (h / 2) - (NODE_HEADER_H / 2), 0.6);

        const nodeTopLine = new THREE.Mesh(new THREE.BoxGeometry(w, 3.2, 9.4), new THREE.MeshStandardMaterial({
          color: color,
          roughness: 0.32,
          metalness: 0.18,
          emissive: color,
          emissiveIntensity: 0.18
        }));
        nodeTopLine.position.set(0, (h / 2) - 2.2, 0.8);

        const contentPanel = new THREE.Mesh(new THREE.BoxGeometry(w - 8, h - NODE_HEADER_H - 8, 7.4), new THREE.MeshStandardMaterial({
          color: 0x0f131a,
          roughness: 0.78,
          metalness: 0.04,
          emissive: 0x070a11,
          emissiveIntensity: 0.16
        }));
        contentPanel.position.set(0, -4.5, 0.4);

        const icon = new THREE.Mesh(iconGeom, new THREE.MeshStandardMaterial({
          color: color,
          roughness: 0.35,
          metalness: 0.16,
          emissive: color,
          emissiveIntensity: 0.16
        }));
        icon.position.set((-w / 2) + 16, (h / 2) - (NODE_HEADER_H / 2), 1.0);

        const accent = new THREE.Mesh(new THREE.BoxGeometry(4, h - 4, 9.2), new THREE.MeshStandardMaterial({
          color: color,
          roughness: 0.35,
          metalness: 0.12,
          emissive: color,
          emissiveIntensity: 0.2
        }));
        accent.position.set((-w / 2) + 2.4, 0, 0.7);

        const label = makeLabelSprite(labelText);
        label.position.set((-w / 2) + 88, (h / 2) - (NODE_HEADER_H / 2), 6.5);
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
        const rowCount = Math.max(2, Math.min(8, Math.max(inputs.length, outputs.length, 2)));
        const rowTop = (h / 2) - NODE_HEADER_H - 8;
        const rowBottom = (-h / 2) + 8;
        const rowStep = rowCount > 1 ? (rowTop - rowBottom) / (rowCount - 1) : 0;
        const rowY = (index) => rowTop - (rowStep * index);

        if (!isArchitectureMode) {
          for (let ri = 0; ri < rowCount; ri++) {
            const y = rowY(ri);
            if (ri > 0) {
              const divider = new THREE.Mesh(
                new THREE.BoxGeometry(w - 12, 0.8, 7.6),
                new THREE.MeshStandardMaterial({
                  color: 0x263041,
                  roughness: 0.9,
                  metalness: 0.02,
                  emissive: 0x0b1220,
                  emissiveIntensity: 0.1
                })
              );
              divider.position.set(0, y + (rowStep / 2), 0.9);
              group.add(divider);
            }
          }
        }

        const makePort = (x, y, dir, port) => {
          const p = new THREE.Group();
          p.position.set(x, y, 4.8);
          p.userData.kind = 'port';
          p.userData.nodeId = node.id;
          p.userData.portId = port.id;
          p.userData.direction = dir;
          p.userData.portName = port.name;
          p.userData.portKind = port.kind;
          p.userData.portDetail = port.detail || '';

          const outer = new THREE.Mesh(
            portOuterGeom,
            new THREE.MeshStandardMaterial({
              color: dir === 'out' ? portColors.out : portColors.in,
              roughness: 0.34,
              metalness: 0.15,
              emissive: dir === 'out' ? 0x166534 : 0x4c1d95,
              emissiveIntensity: 0.26
            })
          );
          const inner = new THREE.Mesh(
            portInnerGeom,
            new THREE.MeshStandardMaterial({
              color: 0x0b1018,
              roughness: 0.85,
              metalness: 0.02,
              emissive: 0x020617,
              emissiveIntensity: 0.2
            })
          );
          outer.userData = p.userData;
          p.add(outer, inner);
          portMeshes.push(outer);
          return p;
        };

        const rowIndexForPort = (index, count) => {
          if (count <= 1) return Math.floor((rowCount - 1) / 2);
          return Math.round((index / (count - 1)) * (rowCount - 1));
        };

        for (let i = 0; i < inputs.length; i++) {
          const y = rowY(rowIndexForPort(i, inputs.length));
          const port = inputs[i];
          const p = makePort((-w / 2) - 2, y, 'in', port);
          const portName = makeTinyLabelSprite(fitLabel(port.name || port.id || 'in', 14));
          portName.position.set((-w / 2) + 20, y, 6.6);
          ports.in.push({ mesh: p, port: port });
          ports.byId.set(port.id, p);
          group.add(p, portName);
        }
        for (let i = 0; i < outputs.length; i++) {
          const y = rowY(rowIndexForPort(i, outputs.length));
          const port = outputs[i];
          const p = makePort((w / 2) + 2, y, 'out', port);
          const portName = makeTinyLabelSprite(fitLabel(port.name || port.id || 'out', 14));
          portName.position.set((w / 2) - 44, y, 6.6);
          ports.out.push({ mesh: p, port: port });
          ports.byId.set(port.id, p);
          group.add(p, portName);
        }

        const outline = new THREE.LineSegments(
          new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, 8.1)),
          new THREE.LineBasicMaterial({
            color: 0x3b4557,
            transparent: true,
            opacity: 0.55
          })
        );

        group.add(shadow, body, contentPanel, header, nodeTopLine, accent, icon, label, outline);
        nodeGroup.add(group);
        nodeBodies.push(body);
        nodeByMeshUuid.set(body.uuid, node);
        nodeMeta.set(node.id, {
          group: group,
          body: body,
          header: header,
          accent: accent,
          icon: icon,
          label: label,
          baseColor: color,
          w: w,
          h: h,
          ports: ports,
          node: node
        });
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
      for (let ei = 0; ei < renderEdges.length; ei++) {
        const edge = renderEdges[ei];
        const lineGeom = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
        const edgeTheme = getEdgeTheme(edge);
        const edgeColor = edgeTheme.baseColor;
        const lineMat = edgeTheme.dashed
          ? new THREE.LineDashedMaterial({ color: edgeColor, transparent: true, opacity: edgeTheme.baseOpacity, dashSize: 16, gapSize: 10 })
          : new THREE.LineBasicMaterial({ color: edgeColor, transparent: true, opacity: edgeTheme.baseOpacity });
        const line = new THREE.Line(lineGeom, lineMat);
        edgeGroup.add(line);

        const arrow = new THREE.Mesh(
          new THREE.ConeGeometry(6.2, 16, 14),
          new THREE.MeshBasicMaterial({ color: edgeColor, transparent: true, opacity: 0.62 })
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
        const label = showLabel ? makeEdgeLabel(edge.label, edgeTheme.baseColor) : null;
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
          theme: edgeTheme,
          isArchitectureMode: isArchitectureMode
        });

        const a1 = adjacency.get(edge.from) || [];
        a1.push(edges.length - 1);
        adjacency.set(edge.from, a1);
        const a2 = adjacency.get(edge.to) || [];
        a2.push(edges.length - 1);
        adjacency.set(edge.to, a2);
      }

      if (!viewLocked) {
        fitViewToGraph(positions);
      }
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
      if (typeof e.line.computeLineDistances === 'function') {
        e.line.computeLineDistances();
      }

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

    function formatEdgeLine(edge, nodeId) {
      const dir = (edge.from === nodeId) ? '->' : '<-';
      const other = (edge.from === nodeId) ? edge.to : edge.from;
      const label = edge.label ? (' (' + edge.label + ')') : '';
      const kind = edge.kind ? (' [' + edge.kind + ']') : '';
      return dir + ' ' + other + label + kind;
    }

    function updateSelectionActions(node, hiddenCount) {
      if (!includeExternalBtn) {
        return;
      }
      const showInclude = !!node && !!selectedNodeId && !!skeletonNodeIds;
      includeExternalBtn.style.display = showInclude ? 'inline-flex' : 'none';
      includeExternalBtn.disabled = !showInclude || hiddenCount <= 0;
      includeExternalBtn.textContent =
        hiddenCount > 0
          ? 'Include external neighbors (' + hiddenCount + ')'
          : 'Include external neighbors';

      if (disconnectContextBtn) {
        const canDisconnect =
          !!node &&
          node.id !== contextBotId &&
          nodeFeedsContextBot(node.id);
        disconnectContextBtn.style.display = canDisconnect ? 'inline-flex' : 'none';
        disconnectContextBtn.disabled = !canDisconnect;
      }
    }

    function setDetails(node) {
      if (!node) {
        details.textContent = 'None';
        updateSelectionActions(undefined, 0);
        updateRelationUi();
        return;
      }
      const idxs = adjacency.get(node.id) || [];
      const visibleLines = [];
      const visibleEdgeIds = new Set();
      const collapseKey = getCollapseKeyForNode(node);
      const isCollapsed = collapseKey ? collapsedLayers.has(collapseKey) : false;
      for (let i = 0; i < Math.min(18, idxs.length); i++) {
        const e = edges[idxs[i]];
        if (!e) continue;
        visibleEdgeIds.add(e.edge.id);
        visibleLines.push(formatEdgeLine(e.edge, node.id));
      }

      const globalEdgesByMode = getVisibleGraph(graph, null).edges;
      const hiddenGlobalLines = [];
      for (let i = 0; i < globalEdgesByMode.length; i++) {
        const edge = globalEdgesByMode[i];
        if (edge.from !== node.id && edge.to !== node.id) {
          continue;
        }
        if (visibleEdgeIds.has(edge.id)) {
          continue;
        }
        hiddenGlobalLines.push(formatEdgeLine(edge, node.id));
      }

      updateSelectionActions(node, hiddenGlobalLines.length);

      const aiSummary = aiNodeSummaryMap.get(node.id);
      details.textContent = [
        'label: ' + node.label,
        'type: ' + node.type,
        node.layer ? 'layer: ' + node.layer : null,
        skeletonRootNodeId ? 'skeleton: active' : null,
        collapseKey ? ('collapsed: ' + (isCollapsed ? 'yes' : 'no')) : null,
        node.detail ? 'detail: ' + node.detail : null,
        aiSummary ? ('ai: ' + aiSummary) : null,
        typeof node.line === 'number' ? 'line: ' + (node.line + 1) : null,
        visibleLines.length ? ('visible edges:\\n' + visibleLines.join('\\n')) : 'visible edges: none',
        hiddenGlobalLines.length ? ('hidden global edges:\\n' + hiddenGlobalLines.join('\\n')) : 'hidden global edges: none'
      ].filter(Boolean).join('\\n');
      updateRelationUi();
    }

    function includeExternalNeighborsForSelected() {
      if (!selectedNodeId) {
        return;
      }

      if (!skeletonNodeIds) {
        skeletonRootNodeId = selectedNodeId;
        skeletonNodeIds = new Set([selectedNodeId]);
      }

      const baseGraph = getVisibleGraph(graph, null);
      for (let i = 0; i < baseGraph.edges.length; i++) {
        const edge = baseGraph.edges[i];
        if (edge.from === selectedNodeId || edge.to === selectedNodeId) {
          skeletonNodeIds.add(edge.from);
          skeletonNodeIds.add(edge.to);
        }
      }

      buildGraphScene(graph);
      const refreshedNode = nodeMeta.get(selectedNodeId)?.node;
      if (refreshedNode) {
        setDetails(refreshedNode);
      }
    }

    function setNodeHighlight(nodeId, mode = 'off') {
      const meta = nodeMeta.get(nodeId);
      if (!meta) return;
      const bodyMat = meta.body.material;
      const headerMat = meta.header?.material;
      const accentMat = meta.accent?.material;
      const iconMat = meta.icon?.material;

      if (mode === 'off') {
        bodyMat.color.setHex(NODE_BODY_COLOR);
        bodyMat.emissive.setHex(0x090d13);
        bodyMat.emissiveIntensity = 0.2;
        if (headerMat) {
          headerMat.color.setHex(NODE_HEADER_COLOR);
          headerMat.emissive.setHex(0x111827);
          headerMat.emissiveIntensity = 0.16;
        }
        if (accentMat) {
          accentMat.color.setHex(meta.baseColor || NODE_ACCENT_COLOR);
          accentMat.emissive.setHex(meta.baseColor || NODE_ACCENT_COLOR);
          accentMat.emissiveIntensity = 0.18;
        }
        if (iconMat) {
          iconMat.color.setHex(meta.baseColor || NODE_ACCENT_COLOR);
          iconMat.emissive.setHex(meta.baseColor || NODE_ACCENT_COLOR);
          iconMat.emissiveIntensity = 0.14;
        }
        if (meta.label && meta.label.material) {
          meta.label.material.opacity = 0.95;
          meta.label.material.color.setHex(0xffffff);
        }
        return;
      }

      const linked = mode === 'linked';
      const focus = mode === 'focus';
      bodyMat.color.setHex(focus ? 0x22324d : 0x202734);
      bodyMat.emissive.setHex(focus ? 0x1e3a5f : 0x15253d);
      bodyMat.emissiveIntensity = focus ? 0.42 : 0.26;
      if (headerMat) {
        headerMat.color.setHex(focus ? 0x2f3f57 : 0x2a364a);
        headerMat.emissive.setHex(focus ? 0x1f4b72 : 0x1e3a5f);
        headerMat.emissiveIntensity = focus ? 0.34 : 0.24;
      }
      if (accentMat) {
        accentMat.color.setHex(focus ? 0x22c55e : 0x4ade80);
        accentMat.emissive.setHex(focus ? 0x22c55e : 0x4ade80);
        accentMat.emissiveIntensity = focus ? 0.48 : 0.3;
      }
      if (iconMat) {
        iconMat.color.setHex(linked ? 0x86efac : 0xbbf7d0);
        iconMat.emissive.setHex(linked ? 0x86efac : 0xbbf7d0);
        iconMat.emissiveIntensity = focus ? 0.5 : 0.28;
      }
      if (meta.label && meta.label.material) {
        meta.label.material.opacity = focus ? 1 : 0.98;
        meta.label.material.color.setHex(focus ? 0xffffff : 0xe2e8f0);
      }
    }

    function updatePointer(ev) {
      const rect = canvas.getBoundingClientRect();
      pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -(((ev.clientY - rect.top) / rect.height) * 2 - 1);
    }

    let hoveredNodeId = null;
    let selectedNodeId = null;
    const contextBotId = 'context:bot';
    let dragging = null; // { nodeId, startX, startY, moved }
    if (skeletonRootNodeId) {
      selectedNodeId = skeletonRootNodeId;
    }

    // Hand mode (pan) like Node-RED: double-click toggles.
    let handMode = false;
    let spacePanActive = false;
    let panning = null; // { startX, startY, camX, camY, targetX, targetY }

    function setCursor() {
      if (panning) {
        canvas.style.cursor = 'grabbing';
        return;
      }
      if (handMode || spacePanActive) {
        canvas.style.cursor = 'grab';
        return;
      }
      canvas.style.cursor = '';
    }

    function toggleHandMode() {
      handMode = !handMode;
      setCursor();
    }

    function persistUiState() {
      try {
        vscode?.setState?.({
          viewMode: viewMode,
          collapsedLayers: Array.from(collapsedLayers),
          edgeFilterMode: edgeFilterMode,
          fullArchitectureDependencyMode: fullArchitectureDependencyMode,
          currentGraphScope: currentGraphScope,
          hudMinimized: hudMinimized,
          hudMaximized: hudMaximized,
          viewLocked: viewLocked,
          relationChatCollapsed: relationChatCollapsed,
          relationFromNodeId: relationFromNodeId || undefined,
          relationToNodeId: relationToNodeId || undefined,
          relationChatDraft: relationChatDraft
        });
      } catch {}
    }

    function applyHudState() {
      document.body.classList.toggle('hud-minimized', hudMinimized);
      document.body.classList.toggle('hud-maximized', hudMaximized);
      document.body.classList.toggle('relation-chat-collapsed', relationChatCollapsed);
      if (hudMinBtn) {
        hudMinBtn.classList.toggle('active', hudMinimized);
        hudMinBtn.title = hudMinimized ? 'Restore HUD' : 'Minimize HUD';
        hudMinBtn.setAttribute('aria-label', hudMinimized ? 'Restore HUD' : 'Minimize HUD');
        const minIcon = hudMinBtn.querySelector('.hud-control-btn-icon');
        if (minIcon) {
          minIcon.textContent = hudMinimized
            ? String.fromCodePoint(0x25A3)
            : String.fromCodePoint(0x2212);
        }
      }
      if (hudMaxBtn) {
        hudMaxBtn.classList.toggle('active', hudMaximized);
        hudMaxBtn.title = hudMaximized ? 'Normalize HUD' : 'Maximize HUD';
        hudMaxBtn.setAttribute('aria-label', hudMaximized ? 'Normalize HUD' : 'Maximize HUD');
        const maxIcon = hudMaxBtn.querySelector('.hud-control-btn-icon');
        if (maxIcon) {
          maxIcon.textContent = hudMaximized
            ? String.fromCodePoint(0x2750)
            : String.fromCodePoint(0x25A2);
        }
        hudMaxBtn.disabled = hudMinimized;
      }
      if (viewLockBtn) {
        viewLockBtn.classList.toggle('active', viewLocked);
        viewLockBtn.title = viewLocked ? 'Unlock view' : 'Lock view';
        viewLockBtn.setAttribute('aria-label', viewLocked ? 'Unlock view' : 'Lock view');
        const lockIcon = viewLockBtn.querySelector('.hud-control-btn-icon');
        if (lockIcon) {
          lockIcon.textContent = viewLocked
            ? String.fromCodePoint(0x1f512)
            : String.fromCodePoint(0x1f513);
        }
      }
      if (relationChatBody) {
        relationChatBody.style.display = relationChatCollapsed ? 'none' : 'flex';
      }
      if (relationChatToggleBtn) {
        relationChatToggleBtn.innerHTML = relationChatCollapsed ? '&#9634;' : '&#8722;';
        relationChatToggleBtn.title = relationChatCollapsed ? 'Expand relation chat' : 'Collapse relation chat';
        relationChatToggleBtn.setAttribute('aria-label', relationChatCollapsed ? 'Expand relation chat' : 'Collapse relation chat');
      }
      persistUiState();
    }

    function toggleHudMinimized() {
      hudMinimized = !hudMinimized;
      if (hudMinimized) {
        hudMaximized = false;
      }
      applyHudState();
    }

    function toggleHudMaximized() {
      if (hudMinimized) {
        hudMinimized = false;
      }
      hudMaximized = !hudMaximized;
      applyHudState();
    }

    function toggleViewLock() {
      viewLocked = !viewLocked;
      applyHudState();
    }

    function updateModeUi() {
      if (modeArchitectureBtn) {
        modeArchitectureBtn.classList.toggle('active', viewMode === 'architecture');
      }
      if (modeRuntimeBtn) {
        modeRuntimeBtn.classList.toggle('active', viewMode === 'runtime');
      }
      if (fullArchitectureBtn) {
        fullArchitectureBtn.classList.toggle('active', currentGraphScope === 'full-architecture');
      }
      if (currentFileBtn) {
        currentFileBtn.classList.toggle('active', currentGraphScope === 'current-file');
      }
      if (codeFlowBtn) {
        codeFlowBtn.classList.toggle('active', currentGraphScope === 'codeflow');
      }
      if (edgeFilterBtn) {
        edgeFilterBtn.textContent = edgeFilterMode === 'api-high' ? 'Edges: API-high' : 'Edges: All';
      }
      if (depImportsBtn) {
        depImportsBtn.classList.toggle('active', fullArchitectureDependencyMode === 'imports');
        depImportsBtn.disabled = currentGraphScope !== 'full-architecture';
      }
      if (depImportsCallsBtn) {
        depImportsCallsBtn.classList.toggle('active', fullArchitectureDependencyMode === 'imports-calls');
        depImportsCallsBtn.disabled = currentGraphScope !== 'full-architecture';
      }
      if (modeHint) {
        if (currentGraphScope === 'full-architecture') {
          modeHint.textContent =
            'Full Architecture: 1-hop file dependencies from current file (' +
            (fullArchitectureDependencyMode === 'imports-calls' ? 'imports + call hierarchy' : 'imports/exports only') +
            '). Edge filter: ' + (edgeFilterMode === 'api-high' ? 'API-high only' : 'All');
        } else {
          modeHint.textContent =
            viewMode === 'architecture'
              ? ('Architecture view: grouped by layers. Click a layer to collapse. Edge filter: ' + (edgeFilterMode === 'api-high' ? 'API-high only' : 'All'))
              : ('Runtime view: function call/data-flow with ports and animated movement. Click output port, then Context Bot to connect context (repeat to detach). Ctrl+click nodes to set relation From/To. Use /explain, /reset, /export file.md -e|-u, and /read file.md in relation chat. Edge filter: ' + (edgeFilterMode === 'api-high' ? 'API-high only' : 'All'));
        }
      }
      if (collapseAllBtn) {
        collapseAllBtn.disabled = viewMode !== 'architecture';
      }
      if (expandAllBtn) {
        expandAllBtn.disabled = viewMode !== 'architecture';
      }
      updateFabVisibility();
      persistUiState();
    }

    function updateGraphifyContextIndicator() {
      if (!graphifyContextIndicator) {
        return;
      }
      graphifyContextIndicator.textContent = 'Graphify Context: ' + (graphifyContextEnabled ? 'On' : 'Off');
      graphifyContextIndicator.classList.toggle('on', !!graphifyContextEnabled);
      graphifyContextIndicator.classList.toggle('off', !graphifyContextEnabled);
    }

    function escapeHtmlText(text) {
      return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function inlineMarkdown(text) {
      let out = escapeHtmlText(text);
      out = out.replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>');
      out = out.replace(/\\x60([^\\x60]+)\\x60/g, '<code>$1</code>');
      return out;
    }

    function markdownToMiniHtml(markdown) {
      const lines = String(markdown || '').replace(/\\r\\n/g, '\\n').split('\\n');
      const out = [];
      let inCode = false;
      let listMode = '';
      const TICK = String.fromCharCode(96);
      const TRIPLE_TICK = TICK + TICK + TICK;
      const closeList = () => {
        if (listMode === 'ul') out.push('</ul>');
        if (listMode === 'ol') out.push('</ol>');
        listMode = '';
      };
      for (let i = 0; i < lines.length; i++) {
        const raw = lines[i];
        const line = raw.trim();
        if (line.startsWith(TRIPLE_TICK)) {
          closeList();
          out.push(inCode ? '</code></pre>' : '<pre><code>');
          inCode = !inCode;
          continue;
        }
        if (inCode) {
          out.push(escapeHtmlText(raw) + '\\n');
          continue;
        }
        if (!line) {
          closeList();
          continue;
        }
        if (line.startsWith('### ')) {
          closeList();
          out.push('<h3>' + inlineMarkdown(line.slice(4)) + '</h3>');
          continue;
        }
        if (line.startsWith('## ')) {
          closeList();
          out.push('<h2>' + inlineMarkdown(line.slice(3)) + '</h2>');
          continue;
        }
        if (line.startsWith('# ')) {
          closeList();
          out.push('<h1>' + inlineMarkdown(line.slice(2)) + '</h1>');
          continue;
        }
        if (/^[-*]\\s+/.test(line)) {
          if (listMode !== 'ul') {
            closeList();
            out.push('<ul>');
            listMode = 'ul';
          }
          out.push('<li>' + inlineMarkdown(line.replace(/^[-*]\\s+/, '')) + '</li>');
          continue;
        }
        if (/^\\d+\\.\\s+/.test(line)) {
          if (listMode !== 'ol') {
            closeList();
            out.push('<ol>');
            listMode = 'ol';
          }
          out.push('<li>' + inlineMarkdown(line.replace(/^\\d+\\.\\s+/, '')) + '</li>');
          continue;
        }
        closeList();
        out.push('<p>' + inlineMarkdown(line) + '</p>');
      }
      closeList();
      return out.join('') || '<p>No AI output.</p>';
    }

    function isChatNearBottom() {
      if (!relationChatTimeline) {
        return true;
      }
      const remaining = relationChatTimeline.scrollHeight - relationChatTimeline.scrollTop - relationChatTimeline.clientHeight;
      return remaining < 28;
    }

    function renderRelationChatTimeline(forceStickToBottom = false) {
      if (!relationChatTimeline) {
        return;
      }
      const stickToBottom = forceStickToBottom || isChatNearBottom();
      relationChatTimeline.textContent = '';

      for (let i = 0; i < relationChatMessages.length; i++) {
        const msg = relationChatMessages[i];
        const card = document.createElement('div');
        card.className = 'relation-chat-msg ' + String(msg.role || 'system');
        if (msg.role === 'assistant' && msg.markdown) {
          card.innerHTML = '<div class="ai-md-block">' + markdownToMiniHtml(String(msg.text || '')) + '</div>';
        } else if (msg.kind === 'suggestions') {
          const title = document.createElement('div');
          title.className = 'ai-suggestions-title';
          title.textContent = String(msg.text || 'Pending AI edge suggestions');
          card.appendChild(title);

          const byId = new Map(graph.nodes.map((node) => [node.id, node]));
          const suggestions = Array.isArray(msg.suggestions) ? msg.suggestions : [];
          const maxRows = 12;
          for (let j = 0; j < Math.min(maxRows, suggestions.length); j++) {
            const edge = suggestions[j];
            const edgeKey = aiSuggestionKey(edge);
            const fromNode = byId.get(edge.from);
            const toNode = byId.get(edge.to);
            const conf = typeof edge.confidence === 'number' ? Math.round(edge.confidence * 100) : 50;
            const row = document.createElement('div');
            row.className = 'ai-suggestion-row';
            const line = document.createElement('div');
            line.className = 'ai-suggestion-line';
            line.textContent =
              (j + 1) +
              '. ' +
              (fromNode?.label || edge.from) +
              ' -> ' +
              (toNode?.label || edge.to) +
              ' [' + String(edge.kind || 'runtime') + ', ' + conf + '%]' +
              (edge.reason ? ': ' + edge.reason : '');
            row.appendChild(line);

            const actions = document.createElement('div');
            actions.className = 'ai-suggestion-actions';
            const applyBtn = document.createElement('button');
            applyBtn.className = 'ai-suggestion-btn';
            applyBtn.type = 'button';
            applyBtn.textContent = 'Apply';
            applyBtn.addEventListener('click', () => applySingleAiSuggestion(edgeKey));
            const rejectBtn = document.createElement('button');
            rejectBtn.className = 'ai-suggestion-btn reject';
            rejectBtn.type = 'button';
            rejectBtn.textContent = 'Reject';
            rejectBtn.addEventListener('click', () => rejectSingleAiSuggestion(edgeKey));
            actions.appendChild(applyBtn);
            actions.appendChild(rejectBtn);
            row.appendChild(actions);
            card.appendChild(row);
          }

          if (suggestions.length > 12) {
            const more = document.createElement('div');
            more.className = 'ai-suggestion-more';
            more.textContent = '... +' + (suggestions.length - 12) + ' more';
            card.appendChild(more);
          }
        } else {
          card.textContent = String(msg.text || '');
        }
        relationChatTimeline.appendChild(card);
      }

      if (!relationChatMessages.length) {
        const empty = document.createElement('div');
        empty.className = 'relation-chat-msg system';
        empty.textContent = 'Relation chat is ready. Set From and To, ask a question, or click Explain.';
        relationChatTimeline.appendChild(empty);
      }

      if (stickToBottom) {
        relationChatTimeline.scrollTop = relationChatTimeline.scrollHeight;
      }
    }

    function pushRelationChatMessage(role, text, options) {
      if (!text) {
        return;
      }
      relationChatMessages.push({
        role: role || 'system',
        text: String(text),
        markdown: !!options?.markdown,
        kind: options?.kind,
        suggestions: options?.suggestions
      });
      if (relationChatMessages.length > 120) {
        relationChatMessages.splice(0, relationChatMessages.length - 120);
      }
      renderRelationChatTimeline(true);
    }

    function getNodeLabelForRelation(nodeId) {
      if (!nodeId) {
        return 'none';
      }
      const node = graph.nodes.find((item) => item.id === nodeId);
      return node ? node.label : nodeId;
    }

    function updateRelationUi() {
      if (relationStateEl) {
        relationStateEl.textContent =
          'From: ' + getNodeLabelForRelation(relationFromNodeId) +
          ' | To: ' + getNodeLabelForRelation(relationToNodeId);
      }
      persistUiState();
    }

    function aiSuggestionKey(edge) {
      return String(edge.from) + '->' + String(edge.to) + ':' + String(edge.kind || 'runtime');
    }

    function mergeAiSuggestions(incoming) {
      const existingGraphKeys = new Set((graph.edges || []).map((edge) => aiSuggestionKey(edge)));
      const pendingByKey = new Map(aiSuggestedEdgesPending.map((edge) => [aiSuggestionKey(edge), edge]));
      for (let i = 0; i < incoming.length; i++) {
        const edge = incoming[i];
        if (!edge || !edge.from || !edge.to || edge.from === edge.to) {
          continue;
        }
        const key = aiSuggestionKey(edge);
        if (existingGraphKeys.has(key)) {
          continue;
        }
        if (!pendingByKey.has(key)) {
          pendingByKey.set(key, edge);
        }
      }
      aiSuggestedEdgesPending = [...pendingByKey.values()];
    }

    function renderAiSuggestionQueue() {
      for (let i = relationChatMessages.length - 1; i >= 0; i--) {
        if (relationChatMessages[i]?.kind === 'suggestions') {
          relationChatMessages.splice(i, 1);
        }
      }
      if (!aiSuggestedEdgesPending.length) {
        if (aiApplyAllBtn) aiApplyAllBtn.disabled = true;
        if (aiRejectAllBtn) aiRejectAllBtn.disabled = true;
        renderRelationChatTimeline();
        return;
      }
      relationChatMessages.push({
        role: 'system',
        text: 'Pending AI edge suggestions',
        kind: 'suggestions',
        suggestions: [...aiSuggestedEdgesPending]
      });
      if (aiApplyAllBtn) aiApplyAllBtn.disabled = false;
      if (aiRejectAllBtn) aiRejectAllBtn.disabled = false;
      renderRelationChatTimeline();
    }

    function dropPendingAiSuggestionByKey(edgeKey) {
      const before = aiSuggestedEdgesPending.length;
      aiSuggestedEdgesPending = aiSuggestedEdgesPending.filter((edge) => aiSuggestionKey(edge) !== edgeKey);
      return aiSuggestedEdgesPending.length !== before;
    }

    function applySingleAiSuggestion(edgeKey) {
      const edge = aiSuggestedEdgesPending.find((item) => aiSuggestionKey(item) === edgeKey);
      if (!edge) {
        return;
      }
      const exists = graph.edges.some((item) => aiSuggestionKey(item) === edgeKey);
      if (!exists) {
        const conf = typeof edge.confidence === 'number' ? Math.round(edge.confidence * 100) : 50;
        graph.edges.push({
          id: makeEdgeId('ai'),
          kind: edge.kind === 'architecture' ? 'architecture' : 'runtime',
          from: edge.from,
          to: edge.to,
          label: (edge.label || 'suggested') + ' [ai-suggested ' + conf + '%]'
        });
      }
      dropPendingAiSuggestionByKey(edgeKey);
      pushRelationChatMessage('system', 'Applied suggestion: ' + String(edge.from) + ' -> ' + String(edge.to));
      renderAiSuggestionQueue();
      buildGraphScene(graph);
      if (selectedNodeId) {
        setDetails(nodeMeta.get(selectedNodeId)?.node || null);
      }
    }

    function rejectSingleAiSuggestion(edgeKey) {
      if (!dropPendingAiSuggestionByKey(edgeKey)) {
        return;
      }
      pushRelationChatMessage('system', 'Rejected one AI suggestion.');
      renderAiSuggestionQueue();
      buildGraphScene(graph);
      if (selectedNodeId) {
        setDetails(nodeMeta.get(selectedNodeId)?.node || null);
      }
    }

    function applyAiSuggestions() {
      if (!aiSuggestedEdgesPending.length) {
        return;
      }
      for (let i = 0; i < aiSuggestedEdgesPending.length; i++) {
        const edge = aiSuggestedEdgesPending[i];
        const conf = typeof edge.confidence === 'number' ? Math.round(edge.confidence * 100) : 50;
        graph.edges.push({
          id: makeEdgeId('ai'),
          kind: edge.kind === 'architecture' ? 'architecture' : 'runtime',
          from: edge.from,
          to: edge.to,
          label: (edge.label || 'suggested') + ' [ai-suggested ' + conf + '%]'
        });
      }
      aiSuggestedEdgesPending = [];
      pushRelationChatMessage('system', 'Applied all pending AI suggestions.');
      renderAiSuggestionQueue();
      buildGraphScene(graph);
      if (selectedNodeId) {
        setDetails(nodeMeta.get(selectedNodeId)?.node || null);
      }
    }

    function rejectAiSuggestions() {
      aiSuggestedEdgesPending = [];
      pushRelationChatMessage('system', 'Rejected all pending AI suggestions.');
      renderAiSuggestionQueue();
      buildGraphScene(graph);
      if (selectedNodeId) {
        setDetails(nodeMeta.get(selectedNodeId)?.node || null);
      }
    }

    function toggleEdgeFilterMode() {
      edgeFilterMode = edgeFilterMode === 'api-high' ? 'all' : 'api-high';
      updateModeUi();
      buildGraphScene(graph);
      setDetails(selectedNodeId ? (nodeMeta.get(selectedNodeId)?.node || null) : null);
    }

    function requestAiEnrichment() {
      if (!vscode || !aiEnrichBtn) {
        return;
      }
      pushRelationChatMessage('user', 'Generate AI insights for current graph.');
      const previous = aiEnrichBtn.textContent;
      aiEnrichBtn.textContent = 'Thinking...';
      aiEnrichBtn.disabled = true;
      vscode.postMessage({ type: 'requestAiEnrichment', scope: currentGraphScope });
      setTimeout(() => {
        aiEnrichBtn.textContent = previous;
        aiEnrichBtn.disabled = false;
      }, 1200);
    }

    function requestAiRelationExplain(options) {
      const fromNodeId = options?.fromNodeId || undefined;
      const toNodeId = options?.toNodeId || undefined;
      const userPrompt = String(options?.userPrompt || '').trim();
      const hasPair = !!fromNodeId && !!toNodeId && fromNodeId !== toNodeId;
      if (!vscode || (!hasPair && !userPrompt)) {
        return;
      }
      pushRelationChatMessage('assistant', 'Analyzing relation...', { markdown: false });
      vscode.postMessage({
        type: 'requestAiRelationExplain',
        fromNodeId,
        toNodeId,
        userPrompt
      });
    }

    function getRelationChatExportTurns() {
      return relationChatMessages
        .filter((item) => item && item.kind !== 'suggestions' && String(item.text || '').trim())
        .map((item) => ({
          role: String(item.role || 'system'),
          text: String(item.text || '')
        }));
    }

    function explainRelationFromState() {
      if (!relationFromNodeId || !relationToNodeId || relationFromNodeId === relationToNodeId) {
        pushRelationChatMessage('error', 'Set From and To first with Ctrl+click on two nodes, then run /explain.');
        return false;
      }
      pushRelationChatMessage(
        'user',
        'Explain relation: ' +
          getNodeLabelForRelation(relationFromNodeId) +
          ' -> ' +
          getNodeLabelForRelation(relationToNodeId)
      );
      requestAiRelationExplain({ fromNodeId: relationFromNodeId, toNodeId: relationToNodeId });
      return true;
    }

    function resetRelationState() {
      relationFromNodeId = null;
      relationToNodeId = null;
      pushRelationChatMessage('system', 'Relation pair reset.');
      updateRelationUi();
    }

    function assignRelationFromCtrlClick(nodeId) {
      const clickedNode = nodeMeta.get(nodeId)?.node || null;
      selectedNodeId = nodeId;
      if (clickedNode) {
        setDetails(clickedNode);
      }

      if (!relationFromNodeId || (relationFromNodeId && relationToNodeId)) {
        relationFromNodeId = nodeId;
        relationToNodeId = null;
        pushRelationChatMessage('system', 'Set From (Ctrl+click): ' + getNodeLabelForRelation(relationFromNodeId));
        updateRelationUi();
        return;
      }

      if (nodeId === relationFromNodeId) {
        pushRelationChatMessage('system', 'From node unchanged. Ctrl+click a different node to set To.');
        updateRelationUi();
        return;
      }

      relationToNodeId = nodeId;
      pushRelationChatMessage('system', 'Set To (Ctrl+click): ' + getNodeLabelForRelation(relationToNodeId));
      updateRelationUi();
    }

    function sendRelationChatPrompt() {
      const userPrompt = String(relationChatInput?.value || '').trim();
      if (!userPrompt) {
        return;
      }

      const normalized = userPrompt.toLowerCase();
      if (normalized === '/reset') {
        pushRelationChatMessage('user', '/reset');
        resetRelationState();
        if (relationChatInput) {
          relationChatInput.value = '';
        }
        relationChatDraft = '';
        updateRelationUi();
        return;
      }

      if (normalized === '/explain') {
        pushRelationChatMessage('user', '/explain');
        explainRelationFromState();
        if (relationChatInput) {
          relationChatInput.value = '';
        }
        relationChatDraft = '';
        updateRelationUi();
        return;
      }
      const exportMatch = userPrompt.match(/^\\/export\\s+([^\\s]+)(?:\\s+(-e|-u))?\\s*$/i);
      if (exportMatch) {
        const fileName = String(exportMatch[1] || '').trim();
        const flag = String(exportMatch[2] || '-u').toLowerCase();
        const exportMode = flag === '-e' ? 'edit' : 'update';
        pushRelationChatMessage('user', userPrompt);
        if (!fileName) {
          pushRelationChatMessage('error', 'Usage: /export <filename.md> -e|-u');
        } else if (vscode) {
          vscode.postMessage({
            type: 'exportRelationChatTranscript',
            fileName,
            exportMode,
            turns: getRelationChatExportTurns()
          });
        }
        if (relationChatInput) {
          relationChatInput.value = '';
        }
        relationChatDraft = '';
        updateRelationUi();
        return;
      }
      const readMatch = userPrompt.match(/^\\/read\\s+(.+)$/i);
      if (readMatch) {
        const fileName = String(readMatch[1] || '').trim();
        pushRelationChatMessage('user', userPrompt);
        if (!fileName) {
          pushRelationChatMessage('error', 'Usage: /read <filename.md>');
        } else if (vscode) {
          vscode.postMessage({
            type: 'readRelationChatContext',
            fileName
          });
        }
        if (relationChatInput) {
          relationChatInput.value = '';
        }
        relationChatDraft = '';
        updateRelationUi();
        return;
      }

      pushRelationChatMessage('user', userPrompt);
      requestAiRelationExplain({
        fromNodeId: relationFromNodeId || undefined,
        toNodeId: relationToNodeId || undefined,
        userPrompt: userPrompt || undefined
      });
      if (relationChatInput) {
        relationChatInput.value = '';
      }
      relationChatDraft = '';
      updateRelationUi();
    }

    function toggleRelationChatCollapsed() {
      relationChatCollapsed = !relationChatCollapsed;
      applyHudState();
    }

    async function requestGraphScope(scope) {
      if (!vscode) {
        return;
      }
      currentGraphScope = scope;
      updateModeUi();
      if (scope === 'full-architecture') {
        skeletonRootNodeId = null;
        skeletonNodeIds = null;
        setViewMode('architecture');
      }
      if (scope === 'codeflow') {
        skeletonRootNodeId = null;
        skeletonNodeIds = null;
        setViewMode('runtime');
      }
      if (scope === 'current-file' && viewMode === 'architecture') {
        // Keep current mode, but reset collapsed state so users see nodes immediately.
        collapsedLayers.clear();
      }
      const targetBtn = scope === 'full-architecture' ? fullArchitectureBtn : (scope === 'codeflow' ? codeFlowBtn : currentFileBtn);
      const otherBtns = [fullArchitectureBtn, currentFileBtn, codeFlowBtn].filter((btn) => btn && btn !== targetBtn);
      const previous = targetBtn?.textContent || '';
      if (targetBtn) {
        targetBtn.textContent = 'Loading...';
        targetBtn.disabled = true;
      }
      for (let i = 0; i < otherBtns.length; i++) {
        otherBtns[i].disabled = true;
      }
      if (depImportsBtn) depImportsBtn.disabled = true;
      if (depImportsCallsBtn) depImportsCallsBtn.disabled = true;
      vscode.postMessage({ type: 'requestGraph', scope, dependencyMode: fullArchitectureDependencyMode });
      // unlock locally after small grace period; host will push graph when ready.
      setTimeout(() => {
        if (targetBtn) {
          targetBtn.textContent =
            previous ||
            (scope === 'full-architecture'
              ? 'Full Architecture'
              : scope === 'codeflow'
                ? 'CodeFlow'
                : 'Current File');
          targetBtn.disabled = false;
        }
        for (let i = 0; i < otherBtns.length; i++) {
          otherBtns[i].disabled = false;
        }
        if (depImportsBtn) depImportsBtn.disabled = currentGraphScope !== 'full-architecture';
        if (depImportsCallsBtn) depImportsCallsBtn.disabled = currentGraphScope !== 'full-architecture';
        updateModeUi();
      }, 1200);
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

      if (connectPreview.active) {
        raycaster.setFromCamera(pointer, camera);
        if (raycaster.ray.intersectPlane(dragPlane, dragPoint)) {
          connectPreview.toPoint.copy(dragPoint);
        }

        connectPreview.snapped = false;
        connectPreview.snapPortId = null;
        const botMeta = nodeMeta.get(contextBotId);
        if (botMeta && botMeta.ports?.in?.length) {
          const SNAP_RADIUS = 42;
          let nearestPort = null;
          let nearestDist = Number.POSITIVE_INFINITY;
          for (let i = 0; i < botMeta.ports.in.length; i++) {
            const p = botMeta.ports.in[i];
            const world = p.mesh.position.clone().add(botMeta.group.position);
            world.z = 0;
            const dist = world.distanceTo(dragPoint);
            if (dist < nearestDist) {
              nearestDist = dist;
              nearestPort = p;
            }
          }
          if (nearestPort && nearestDist <= SNAP_RADIUS) {
            connectPreview.snapped = true;
            connectPreview.snapPortId = nearestPort.port?.id || null;
            connectPreview.toPoint.copy(nearestPort.mesh.position.clone().add(botMeta.group.position));
            connectPreview.toPoint.z = 0;
          }
        }
      }
    }

    function onPointerDown(ev) {
      hideNodeMenu();
      updatePointer(ev);
      const isCtrlClick = (ev.button === 0) && !!ev.ctrlKey;
      if (ev.button === 2) {
        // Right click / two-finger tap is handled by the contextmenu event only.
        return;
      }

      // If clicking a port, show tooltip (no navigation).
      raycaster.setFromCamera(pointer, camera);
      const portHits = raycaster.intersectObjects(portMeshes, false);
      const phit = portHits[0] && portHits[0].object ? portHits[0].object : null;
      if (phit && phit.userData && phit.userData.kind === 'port') {
        setActivePort(phit);
        const nodeId = String(phit.userData.nodeId || '');
        const direction = String(phit.userData.direction || '');
        if (connectPreview.active && nodeId === contextBotId) {
          completeContextConnect();
          return;
        }
        if (direction === 'out' && nodeId !== contextBotId) {
          beginContextConnectFromPort(phit);
          return;
        }
        const name = phit.userData.portName || '';
        const dir = phit.userData.direction || '';
        const kind = phit.userData.portKind || '';
        const det = phit.userData.portDetail || '';
        showPortTip(ev.clientX, ev.clientY, { name, dir, kind, det });
        return;
      }
      hidePortTip();
      if (!phit) {
        setActivePort(null);
      }

      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(nodeBodies, false);
      const hit = hits[0] && hits[0].object ? hits[0].object : null;
      if (hit && hit.userData && hit.userData.nodeId) {
        const nodeId = hit.userData.nodeId;

        if (isCtrlClick) {
          assignRelationFromCtrlClick(nodeId);
          return;
        }

        if (connectPreview.active && nodeId === contextBotId) {
          completeContextConnect();
          return;
        }
        if (connectPreview.active && nodeId !== contextBotId) {
          cancelContextConnect();
        }
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
      if ((handMode || spacePanActive) && ev.button === 0) {
        setActivePort(null);
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
        return;
      }

      if (connectPreview.active && ev.button === 0) {
        cancelContextConnect();
      }
      if (ev.button === 0) {
        setActivePort(null);
      }
    }

    function onPointerUp() {
      if (connectPreview.active && connectPreview.snapped) {
        completeContextConnect();
        return;
      }
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
          if (node && vscode && (node.type === 'function' || node.type === 'sink' || node.type === 'module' || node.type === 'utility')) {
            vscode.postMessage({ type: 'navigate', nodeId: node.id });
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
    canvas.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      updatePointer(ev);
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(nodeBodies, false);
      const hit = hits[0] && hits[0].object ? hits[0].object : null;
      if (hit && hit.userData && hit.userData.nodeId) {
        const nodeId = hit.userData.nodeId;
        selectedNodeId = nodeId;
        const node = nodeMeta.get(nodeId)?.node;
        if (node) {
          setDetails(node);
        }
        showNodeMenu(ev.clientX, ev.clientY, nodeId);
      } else {
        hideNodeMenu();
      }
    });
    window.addEventListener('pointerup', onPointerUp);
    modeArchitectureBtn?.addEventListener('click', () => setViewMode('architecture'));
    modeRuntimeBtn?.addEventListener('click', () => setViewMode('runtime'));
    collapseAllBtn?.addEventListener('click', collapseAllLayers);
    expandAllBtn?.addEventListener('click', expandAllLayers);
    fullArchitectureBtn?.addEventListener('click', () => requestGraphScope('full-architecture'));
    currentFileBtn?.addEventListener('click', () => requestGraphScope('current-file'));
    codeFlowBtn?.addEventListener('click', () => requestGraphScope('codeflow'));
    depImportsBtn?.addEventListener('click', () => {
      fullArchitectureDependencyMode = 'imports';
      updateModeUi();
      if (currentGraphScope === 'full-architecture') {
        requestGraphScope('full-architecture');
      }
    });
    depImportsCallsBtn?.addEventListener('click', () => {
      fullArchitectureDependencyMode = 'imports-calls';
      updateModeUi();
      if (currentGraphScope === 'full-architecture') {
        requestGraphScope('full-architecture');
      }
    });
    edgeFilterBtn?.addEventListener('click', toggleEdgeFilterMode);
    aiEnrichBtn?.addEventListener('click', requestAiEnrichment);
    aiApplyAllBtn?.addEventListener('click', applyAiSuggestions);
    aiRejectAllBtn?.addEventListener('click', rejectAiSuggestions);
    relationChatToggleBtn?.addEventListener('click', (ev) => {
      ev.stopPropagation();
      toggleRelationChatCollapsed();
    });
    relationChatHeader?.addEventListener('click', (ev) => {
      if (ev.target === relationChatToggleBtn) {
        return;
      }
      toggleRelationChatCollapsed();
    });
    relationChatInput?.addEventListener('input', () => {
      relationChatDraft = String(relationChatInput?.value || '');
      updateRelationUi();
    });
    relationChatInput?.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && !ev.shiftKey) {
        ev.preventDefault();
        sendRelationChatPrompt();
      }
    });
    if (relationChatInput) {
      relationChatInput.value = relationChatDraft;
    }
    includeExternalBtn?.addEventListener('click', includeExternalNeighborsForSelected);
    disconnectContextBtn?.addEventListener('click', () => {
      if (!selectedNodeId || selectedNodeId === contextBotId) {
        return;
      }
      disconnectNodeFromContextBot(selectedNodeId);
    });
    viewLockBtn?.addEventListener('click', toggleViewLock);
    hudMinBtn?.addEventListener('click', toggleHudMinimized);
    hudMaxBtn?.addEventListener('click', toggleHudMaximized);
    fabAdd?.addEventListener('click', (ev) => {
      ev.stopPropagation();
      toggleFabMenu();
    });
    addContextBotBtn?.addEventListener('click', (ev) => {
      ev.stopPropagation();
      ensureContextBotNode();
      hideFabMenu();
      selectedNodeId = contextBotId;
      const botNode = nodeMeta.get(contextBotId)?.node;
      if (botNode) {
        setDetails(botNode);
      }
    });
    window.addEventListener('pointerdown', (ev) => {
      const target = ev.target;
      if (nodeMenu && nodeMenu.style.display === 'block' && target instanceof Node && !nodeMenu.contains(target)) {
        hideNodeMenu();
      }
      if (fabMenu && fabMenu.classList.contains('show') && target instanceof Node) {
        const insideFab = (fabMenu.contains(target) || (fabAdd && fabAdd.contains(target)));
        if (!insideFab) {
          hideFabMenu();
        }
      }
    });
    window.addEventListener('keydown', (ev) => {
      const target = ev.target;
      const isTypingTarget =
        target instanceof HTMLElement &&
        (
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable
        );
      if (isTypingTarget) {
        return;
      }
      if (ev.code === 'Space') {
        spacePanActive = true;
        setCursor();
        ev.preventDefault();
        return;
      }
      if (ev.key === 'f' || ev.key === 'F') {
        fitViewToGraph();
        ev.preventDefault();
      }
    });
    window.addEventListener('keyup', (ev) => {
      if (ev.code === 'Space') {
        spacePanActive = false;
        setCursor();
      }
    });
    window.addEventListener('blur', () => {
      if (spacePanActive) {
        spacePanActive = false;
        setCursor();
      }
    });
    canvas.addEventListener('dblclick', (ev) => {
      // If double-clicking a node, open node menu (Skeleton / Unskeleton).
      updatePointer(ev);
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(nodeBodies, false);
      if (hits && hits.length && hits[0].object?.userData?.nodeId) {
        showNodeMenu(ev.clientX, ev.clientY, hits[0].object.userData.nodeId);
        return;
      }
      toggleHandMode();
    });
    window.addEventListener('resize', resize);

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg && msg.type === 'graph') {
        graph = msg.graph;
        const validIds = new Set(graph.nodes.map((node) => node.id));
        if (relationFromNodeId && !validIds.has(relationFromNodeId)) {
          relationFromNodeId = null;
        }
        if (relationToNodeId && !validIds.has(relationToNodeId)) {
          relationToNodeId = null;
        }
        aiSuggestedEdgesPending = [];
        renderAiSuggestionQueue();
        updateRelationUi();
        updateFabVisibility();
        buildGraphScene(graph);
        return;
      }
      if (msg && msg.type === 'graphifyContextState') {
        graphifyContextEnabled = !!msg.enabled;
        updateGraphifyContextIndicator();
        return;
      }
      if (msg && msg.type === 'aiEnrichment') {
        if (msg.error) {
          pushRelationChatMessage('error', 'AI Insights failed: ' + String(msg.error));
          return;
        }
        const result = msg.result;
        aiNodeSummaryMap = new Map();
        const summaries = Array.isArray(result?.nodeSummaries) ? result.nodeSummaries : [];
        for (let i = 0; i < summaries.length; i++) {
          const item = summaries[i];
          if (item && item.nodeId && item.summary) {
            aiNodeSummaryMap.set(item.nodeId, String(item.summary));
          }
        }
        const insights = Array.isArray(result?.insights) ? result.insights : [];
        const lines = [];
        for (let i = 0; i < insights.length; i++) {
          const insight = insights[i];
          if (!insight || !insight.title || !insight.detail) {
            continue;
          }
          const conf = typeof insight.confidence === 'number' ? Math.round(insight.confidence * 100) : 50;
          lines.push('* ' + insight.title + ' (' + conf + '%): ' + insight.detail);
        }
        const generatedAt = result?.generatedAt ? new Date(result.generatedAt).toLocaleTimeString() : '';
        const model = result?.modelLabel ? String(result.modelLabel) : 'selected model';
        const graphifyStatus = String(result?.graphifyEvidenceStatus || '');
        const graphifyMessage = String(result?.graphifyEvidenceMessage || '');
        if (graphifyStatus === 'fallback') {
          lines.unshift('* Graphify: ' + (graphifyMessage || 'Graphify node evidence unavailable; using structural fallback.'));
        }
        pushRelationChatMessage(
          'assistant',
          'AI Insights [' + model + '] ' + (generatedAt ? 'at ' + generatedAt : '') + '\\n' +
            (lines.length ? lines.join('\\n') : 'No strong insights found.'),
          { markdown: true }
        );
        const suggested = Array.isArray(result?.suggestedEdges) ? result.suggestedEdges : [];
        mergeAiSuggestions(suggested);
        renderAiSuggestionQueue();
        buildGraphScene(graph);
        if (selectedNodeId) {
          setDetails(nodeMeta.get(selectedNodeId)?.node || null);
        }
        return;
      }
      if (msg && msg.type === 'relationChatExported') {
        if (msg.error) {
          pushRelationChatMessage('error', 'Export failed: ' + String(msg.error));
          return;
        }
        if (msg.skipped) {
          pushRelationChatMessage('system', String(msg.message || 'No new updates to export.'));
          return;
        }
        const createdLabel = msg.created ? 'created' : 'updated';
        const modeLabel = msg.exportMode === 'edit' ? 'incremental (-e)' : 'rewrite (-u)';
        const turnsLabel = typeof msg.exportedTurns === 'number' ? ' | turns: ' + msg.exportedTurns : '';
        pushRelationChatMessage('system', 'Chat transcript ' + createdLabel + ' [' + modeLabel + ']: ' + String(msg.path || msg.fileName || 'markdown file') + turnsLabel);
        return;
      }
      if (msg && msg.type === 'relationChatContextRead') {
        if (msg.error) {
          pushRelationChatMessage('error', 'Read failed: ' + String(msg.error));
          return;
        }
        const size = typeof msg.contextText === 'string' ? msg.contextText.length : 0;
        pushRelationChatMessage('system', 'Loaded extra context from ' + String(msg.path || msg.fileName || 'markdown file') + ' (' + size + ' chars).');
        return;
      }
      if (msg && msg.type === 'aiRelationExplain') {
        relationFromNodeId = msg.fromNodeId || relationFromNodeId;
        relationToNodeId = msg.toNodeId || relationToNodeId;
        if (msg.error) {
          pushRelationChatMessage('error', 'AI Relation Explain failed: ' + String(msg.error));
          updateRelationUi();
          return;
        }
        const fromNodeId = msg.fromNodeId || undefined;
        const toNodeId = msg.toNodeId || undefined;
        if (fromNodeId && toNodeId) {
          const fromNode = graph.nodes.find((node) => node.id === fromNodeId);
          const toNode = graph.nodes.find((node) => node.id === toNodeId);
          const pairLabel = (fromNode?.label || fromNodeId) + ' -> ' + (toNode?.label || toNodeId);
          pushRelationChatMessage(
            'assistant',
            'AI Relation Explain [' + pairLabel + ']\\n' + String(msg.text || 'No relation explanation generated.'),
            { markdown: true }
          );
        } else {
          pushRelationChatMessage('assistant', String(msg.text || 'No relation explanation generated.'), { markdown: true });
        }
        updateRelationUi();
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

    function hideNodeMenu() {
      if (!nodeMenu) return;
      nodeMenu.style.display = 'none';
      nodeMenu.textContent = '';
      menuNodeId = null;
    }

    function getSkeletonSet(rootNodeId) {
      // Skeleton = focused node + one-hop incoming/outgoing neighbors.
      const visible = getVisibleGraph(graph, null);
      const result = new Set([rootNodeId]);
      for (let i = 0; i < visible.edges.length; i++) {
        const e = visible.edges[i];
        if (e.from === rootNodeId || e.to === rootNodeId) {
          result.add(e.from);
          result.add(e.to);
        }
      }
      return result;
    }

    function enableSkeleton(rootNodeId) {
      skeletonRootNodeId = rootNodeId;
      skeletonNodeIds = getSkeletonSet(rootNodeId);
      buildGraphScene(graph);
      const node = nodeMeta.get(rootNodeId)?.node;
      if (node) setDetails(node);
    }

    function disableSkeleton() {
      skeletonRootNodeId = null;
      skeletonNodeIds = null;
      buildGraphScene(graph);
      setDetails(null);
    }

    function showNodeMenu(x, y, nodeId) {
      if (!nodeMenu) {
        return;
      }
      const node = nodeMeta.get(nodeId)?.node;
      if (!node) {
        return;
      }
      menuNodeId = nodeId;
      nodeMenu.textContent = '';

      const skeletonActive = !!skeletonRootNodeId;
      const skeletonBtn = document.createElement('button');
      skeletonBtn.textContent = skeletonActive ? 'Unskeleton' : 'Skeleton';
      skeletonBtn.addEventListener('click', () => {
        if (skeletonActive) {
          disableSkeleton();
        } else {
          if (vscode) {
            vscode.postMessage({ type: 'openSkeleton', nodeId: nodeId, label: node.label });
          } else {
            enableSkeleton(nodeId);
          }
        }
        hideNodeMenu();
      });
      nodeMenu.appendChild(skeletonBtn);

      const pinInfoBtn = document.createElement('button');
      pinInfoBtn.textContent = 'Focus Node';
      pinInfoBtn.addEventListener('click', () => {
        const meta = nodeMeta.get(nodeId);
        if (meta) {
          cameraAnim.x = meta.group.position.x;
          cameraAnim.y = meta.group.position.y;
          cameraAnim.zoom = Math.max(0.8, Math.min(1.6, camera.zoom));
          cameraAnim.active = true;
          setDetails(node);
        }
        hideNodeMenu();
      });
      nodeMenu.appendChild(pinInfoBtn);

      const viewCodeBtn = document.createElement('button');
      viewCodeBtn.textContent = 'View Code';
      viewCodeBtn.addEventListener('click', () => {
        if (vscode) {
          vscode.postMessage({ type: 'viewNode', nodeId: nodeId });
        }
        hideNodeMenu();
      });
      nodeMenu.appendChild(viewCodeBtn);

      if (selectedNodeId && selectedNodeId !== nodeId) {
        const explainRelationBtn = document.createElement('button');
        explainRelationBtn.textContent = 'Explain relation to selected';
        explainRelationBtn.addEventListener('click', () => {
          pushRelationChatMessage(
            'user',
            'Explain relation: ' +
              getNodeLabelForRelation(selectedNodeId) +
              ' -> ' +
              getNodeLabelForRelation(nodeId)
          );
          requestAiRelationExplain({ fromNodeId: selectedNodeId, toNodeId: nodeId });
          hideNodeMenu();
        });
        nodeMenu.appendChild(explainRelationBtn);
      }

      if (node.id !== contextBotId && nodeFeedsContextBot(node.id)) {
        const disconnectBtn = document.createElement('button');
        disconnectBtn.textContent = 'Disconnect Context Bot';
        disconnectBtn.addEventListener('click', () => {
          disconnectNodeFromContextBot(node.id);
          hideNodeMenu();
        });
        nodeMenu.appendChild(disconnectBtn);
      }

      if (node.id === contextBotId) {
        const removeBotBtn = document.createElement('button');
        removeBotBtn.textContent = 'Remove Context Bot';
        removeBotBtn.addEventListener('click', () => {
          removeContextBotNode();
          hideNodeMenu();
        });
        nodeMenu.appendChild(removeBotBtn);
      }

      nodeMenu.style.left = Math.max(8, x + 8) + 'px';
      nodeMenu.style.top = Math.max(8, y + 8) + 'px';
      nodeMenu.style.display = 'block';
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
          if (hoveredNodeId) setNodeHighlight(hoveredNodeId, 'off');
          hoveredNodeId = nextId;
          if (hoveredNodeId) setNodeHighlight(hoveredNodeId, 'focus');
        }
      }

      // Edge styling: dim by default, highlight connected edges on hover.
      for (let i = 0; i < edges.length; i++) {
        const e = edges[i];
        const baseColor = e.theme?.baseColor ?? (e.edge.kind === 'architecture' ? 0x98a2b3 : 0xb8c2d0);
        const baseOpacity = e.theme?.baseOpacity ?? (e.edge.kind === 'architecture' ? 0.42 : 0.34);
        e.line.material.opacity = baseOpacity;
        e.line.material.color.setHex(baseColor);
        e.arrow.material.opacity = e.isArchitectureMode ? 0 : 0.46;
        e.arrow.material.color.setHex(baseColor);
      }
      // Node styling: reset before hover/selection highlights.
      for (const [nodeId] of nodeMeta) {
        setNodeHighlight(nodeId, 'off');
      }
      if (skeletonNodeIds) {
        for (const id of skeletonNodeIds) {
          if (nodeMeta.has(id)) {
            setNodeHighlight(id, 'linked');
          }
        }
      }
      const focusNodeId = hoveredNodeId || selectedNodeId || skeletonRootNodeId;
      if (focusNodeId) {
        const idxs = adjacency.get(focusNodeId) || [];
        const connectedNodeIds = new Set([focusNodeId]);
        for (let i = 0; i < idxs.length; i++) {
          const e = edges[idxs[i]];
          if (!e) continue;
          connectedNodeIds.add(e.edge.from);
          connectedNodeIds.add(e.edge.to);
          e.line.material.opacity = e.edge.kind === 'architecture' ? 0.62 : 0.78;
          e.line.material.color.setHex(e.theme?.focusColor ?? 0x22c55e);
          e.arrow.material.opacity = e.isArchitectureMode ? 0 : 0.65;
          e.arrow.material.color.setHex(e.theme?.focusColor ?? 0x22c55e);
        }
        for (const id of connectedNodeIds) {
          setNodeHighlight(id, id === focusNodeId ? 'focus' : 'linked');
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

      if (connectPreview.line) {
        if (connectPreview.active) {
          connectPreview.line.visible = true;
          connectPreview.line.geometry.setFromPoints([
            connectPreview.fromPoint.clone(),
            connectPreview.toPoint.clone()
          ]);
          connectPreview.line.computeLineDistances();
        } else {
          connectPreview.line.visible = false;
        }
      }

      renderer.render(scene, camera);
    }

    resize();
    applyHudState();
    updateModeUi();
    updateRelationUi();
    renderAiSuggestionQueue();
    updateGraphifyContextIndicator();
    applySceneThemeByMode();
    if (skeletonRootNodeId) {
      viewMode = 'runtime';
      skeletonNodeIds = getSkeletonSet(skeletonRootNodeId);
      updateModeUi();
      applySceneThemeByMode();
    }
    buildGraphScene(graph);
    if (skeletonRootNodeId) {
      const focused = nodeMeta.get(skeletonRootNodeId)?.node;
      if (focused) {
        setDetails(focused);
      }
    }
    animate();
`;
}


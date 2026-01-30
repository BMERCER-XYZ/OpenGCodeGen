import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// Theme Colors
const COLOR_STOCK = 0xdddddd;
const COLOR_RAPID = 0xff0000;
const COLOR_FEED = 0x0000ff;
const COLOR_GRID = 0x888888;
const COLOR_BG = 0x0b0b10;
const COLOR_TOOL = 0xFF00FF; // Magenta tool

export class GCodeViewer {
    constructor(container) {
        this.container = container;
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        this.toolpathGroup = null;
        this.stockMesh = null;
        this.toolMesh = null;
        
        // Animation State
        this.isAnimating = false;
        this.isPlaying = false;
        this.animationPath = []; // Array of {pos: Vector3, type: G0/G1, dist: number}
        this.currentIndex = 0;
        this.progress = 0; // 0 to 1 along current segment
        this.speedMultiplier = 1.0;
        this.baseSpeed = 1000; // mm/min visual baseline
        this.lastTime = 0;
        this.progressCallback = null;
        this.zOffset = 0; // Shift to sit on grid

        // Solid Simulation
        this.solidStockMesh = null;
        this.isSolidMode = false;
        this.stockDims = { w: 100, h: 100, t: 1, origin: 'center' };
        this.simParams = {}; // Store for tool dia

        this.init();
    }

    init() {
        // Scene
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(COLOR_BG);

        // Camera
        const aspect = this.container.clientWidth / this.container.clientHeight;
        this.camera = new THREE.PerspectiveCamera(50, aspect, 0.1, 1000);
        this.camera.position.set(0, -100, 100);
        this.camera.up.set(0, 0, 1);

        // Renderer
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
        this.container.appendChild(this.renderer.domElement);

        // Controls
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.1;

        // Lights
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(ambientLight);
        const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
        dirLight.position.set(50, -50, 100);
        this.scene.add(dirLight);

        // Groups
        this.toolpathGroup = new THREE.Group();
        this.scene.add(this.toolpathGroup);

        // Helpers
        const grid = new THREE.GridHelper(500, 50, COLOR_GRID, 0x444444);
        grid.rotation.x = Math.PI / 2;
        this.scene.add(grid);
        this.axesHelper = new THREE.AxesHelper(20);
        this.scene.add(this.axesHelper);

        // Tool Mesh (Cone)
        const toolGeom = new THREE.ConeGeometry(2, 10, 16);
        toolGeom.rotateX(-Math.PI / 2); // Rotate to point along -Z (down)
        toolGeom.translate(0, 0, 5); // Shift so tip is at (0,0,0) and body extends to +Z
        
        const toolMat = new THREE.MeshLambertMaterial({ color: COLOR_TOOL });
        this.toolMesh = new THREE.Mesh(toolGeom, toolMat);
        this.toolMesh.visible = false;
        this.scene.add(this.toolMesh);

        // Loop
        this.animateLoop();
    }

    animateLoop(time) {
        requestAnimationFrame((t) => this.animateLoop(t));
        
        if (this.isPlaying) {
            const dt = (time - this.lastTime) / 1000; // Seconds
            this.updateAnimation(dt);
        }
        this.lastTime = time;

        this.controls.update();
        this.renderer.render(this.scene, this.camera);
    }

    resize() {
        if (!this.container || this.container.clientWidth === 0) return;
        this.camera.aspect = this.container.clientWidth / this.container.clientHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    }

    update(gcode, params) {
        this.simParams = params;
        this.updateStock(params);
        return this.parseGCode(gcode, params);
    }

    updateStock(params) {
        if (this.stockMesh) this.scene.remove(this.stockMesh);
        if (this.solidStockMesh) {
            this.scene.remove(this.solidStockMesh);
            this.solidStockMesh = null;
            this.isSolidMode = false;
        }

        const w = params.stockWidth || 100;
        const h = params.stockHeight || 100;
        const t = params.stockThickness || 1;
        this.stockDims = { w, h, t, origin: params.origin || 'stock-center' };

        this.zOffset = t;
        if(this.axesHelper) this.axesHelper.position.z = this.zOffset;

        const geometry = new THREE.BoxGeometry(w, h, t);
        const material = new THREE.MeshLambertMaterial({
            color: COLOR_STOCK,
            transparent: true,
            opacity: 0.3,
            side: THREE.DoubleSide
        });

        this.stockMesh = new THREE.Mesh(geometry, material);
        
        // Origin logic
        let shiftX = 0, shiftY = 0;
        const originVal = params.origin || 'stock-center';
        let pos = 'center';
        if (originVal.startsWith('stock-')) pos = originVal.replace('stock-', '');
        
        if (pos === 'bottom-left') { shiftX = w/2; shiftY = h/2; }
        else if (pos === 'bottom-right') { shiftX = -w/2; shiftY = h/2; }
        else if (pos === 'top-left') { shiftX = w/2; shiftY = -h/2; }
        else if (pos === 'top-right') { shiftX = -w/2; shiftY = -h/2; }

        this.stockMesh.position.set(shiftX, shiftY, t/2);
        this.scene.add(this.stockMesh);
    }

    // --- Solid Simulation Logic ---
    
    initSolidStock() {
        if (this.solidStockMesh) {
            this.scene.remove(this.solidStockMesh);
            this.solidStockMesh.geometry.dispose();
            this.solidStockMesh.material.dispose();
        }

        const { w, h, t } = this.stockDims;
        // Resolution: ~0.5mm per segment, max 256
        let segW = Math.min(256, Math.floor(w * 2));
        let segH = Math.min(256, Math.floor(h * 2));
        
        // Ensure at least some resolution
        segW = Math.max(10, segW);
        segH = Math.max(10, segH);

        const geometry = new THREE.PlaneGeometry(w, h, segW, segH);
        
        // Initial Z is at top surface (t)
        
        // Add vertex colors for visual flair (White top, Darker bottom)
        const count = geometry.attributes.position.count;
        const colors = [];
        for (let i = 0; i < count; i++) {
            colors.push(0.9, 0.9, 0.9); // White-ish
        }
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

        // Use Basic Material to rely purely on Vertex Colors (fast, no normal updates needed)
        const material = new THREE.MeshBasicMaterial({
            vertexColors: true,
            side: THREE.DoubleSide
        });

        this.solidStockMesh = new THREE.Mesh(geometry, material);
        
        // Position same as wireframe stock (but at top surface Z=t)
        this.solidStockMesh.position.copy(this.stockMesh.position);
        this.solidStockMesh.position.z = this.stockDims.t; // Top surface

        this.scene.add(this.solidStockMesh);
        
        this.isSolidMode = true;
        this.stockMesh.visible = false; // Hide wireframe
        
        // Re-bind to grid props for fast access
        this.solidStockMesh.userData = {
            segW, segH, w, h
        };
    }

    toggleStockMode() {
        if (!this.solidStockMesh) return;
        this.isSolidMode = !this.isSolidMode;
        this.solidStockMesh.visible = this.isSolidMode;
        this.stockMesh.visible = !this.isSolidMode;
    }

    carve(toolPos) {
        if (!this.solidStockMesh || !this.isSolidMode) return;

        const geo = this.solidStockMesh.geometry;
        const positions = geo.attributes.position;
        const colors = geo.attributes.color;
        const { segW, segH, w, h } = this.solidStockMesh.userData;
        
        // Tool Props
        const toolR = (this.simParams.toolDiameter || 3.175) / 2;
        
        // Tool Pos is World. Convert to Local.
        const localX = toolPos.x - this.solidStockMesh.position.x;
        const localY = toolPos.y - this.solidStockMesh.position.y;
        const localToolZ = toolPos.z - this.solidStockMesh.position.z; 
        
        // Optimization: Bounding Box of Tool in Grid Index
        // Plane goes from -w/2 to +w/2
        const gridX = ((localX + w/2) / w) * segW;
        
        // Three.js PlaneGeometry (default) creates Y from Top (+h/2) to Bottom (-h/2)
        // So Y=+h/2 is index 0. Y=-h/2 is index segH.
        // Map localY (-h/2 to +h/2) to (segH to 0)
        // 1. Normalize Y to 0..1 (Bottom to Top): (localY + h/2) / h
        // 2. Invert for Grid: 1 - Normalized
        // 3. Scale by segH
        const normY = (localY + h/2) / h;
        const gridY = (1.0 - normY) * segH;
        
        // Range of indices to check (Square around tool)
        const radGridW = (toolR / w) * segW;
        const radGridH = (toolR / h) * segH;
        
        const pad = 2; // Increased padding to be safe
        const iMin = Math.max(0, Math.floor(gridX - radGridW - pad));
        const iMax = Math.min(segW, Math.ceil(gridX + radGridW + pad));
        
        const jMin = Math.max(0, Math.floor(gridY - radGridH - pad));
        const jMax = Math.min(segH, Math.ceil(gridY + radGridH + pad));

        let dirty = false;
        
        // Iterate Grid
        for (let j = jMin; j <= jMax; j++) {
            for (let i = iMin; i <= iMax; i++) {
                const index = i + j * (segW + 1);
                
                // Safety check index
                if (index < 0 || index >= positions.count) continue;

                // Get current Vertex Local Pos
                const vx = positions.getX(index);
                const vy = positions.getY(index);
                const vz = positions.getZ(index);
                
                // Distance to Tool Center (XY only)
                const dx = vx - localX;
                const dy = vy - localY;
                const distSq = dx*dx + dy*dy;
                
                if (distSq < toolR * toolR) {
                    // Inside Tool
                    // If Tool is lower than Vertex, Push Vertex Down
                    if (localToolZ < vz) {
                        positions.setZ(index, localToolZ);
                        
                        // Darken color based on depth
                        // Depth relative to top (0). localToolZ is negative.
                        // Map -10mm to 0.2 brightness, 0mm to 0.9 brightness
                        const depth = Math.abs(localToolZ);
                        const darkness = Math.max(0.2, 0.9 - (depth * 0.1));
                        
                        colors.setXYZ(index, darkness, darkness, darkness);
                        
                        dirty = true;
                    }
                }
            }
        }
        
        if (dirty) {
            positions.needsUpdate = true;
            colors.needsUpdate = true;
        }
    }

    // --- End Solid Simulation Logic ---

    parseGCode(gcode, params) {
        // Clear old
        while(this.toolpathGroup.children.length > 0){
            const c = this.toolpathGroup.children[0];
            if(c.geometry) c.geometry.dispose();
            if(c.material) c.material.dispose();
            this.toolpathGroup.remove(c);
        }
        
        this.animationPath = [];
        const lines = gcode.split('\n');
        // Initial pos at Safe Z relative to stock top + offset
        let cur = new THREE.Vector3(0, 0, 5 + this.zOffset); 
        this.animationPath.push({ pos: cur.clone(), type: 'start', dist: 0, lineIndex: 0 });

        let currentType = 'G0';
        let pathPoints = [cur.clone()];
        
        // Stats
        let totalMinutes = 0;
        let layerTimes = new Map(); // Z -> time
        let currentFeed = params.feedRate || 800;
        const rapidXY = params.rapidXY || 7000;
        const rapidZ = params.rapidZ || 500;

        const commitPath = (type) => {
            if (pathPoints.length < 2) return;
            const geo = new THREE.BufferGeometry().setFromPoints(pathPoints);
            const mat = new THREE.LineBasicMaterial({
                color: type === 'G0' ? COLOR_RAPID : COLOR_FEED,
                opacity: type === 'G0' ? 0.5 : 1.0,
                transparent: type === 'G0'
            });
            this.toolpathGroup.add(new THREE.Line(geo, mat));
        };

        lines.forEach((lineRaw, lineIdx) => {
            let line = lineRaw.trim().toUpperCase().split(';')[0];
            if (!line) return;

            let isMove = false;
            let newType = currentType;
            let isArc = false;
            let arcDir = 0;

            if (line.startsWith('G0') || line.startsWith('G00')) { newType = 'G0'; isMove = true; }
            else if (line.startsWith('G1') || line.startsWith('G01')) { newType = 'G1'; isMove = true; }
            else if (line.startsWith('G2') || line.startsWith('G02')) { newType = 'G1'; isMove = true; isArc = true; arcDir = 2; }
            else if (line.startsWith('G3') || line.startsWith('G03')) { newType = 'G1'; isMove = true; isArc = true; arcDir = 3; }

            if (isMove) {
                const getVal = (c) => {
                    const m = line.match(new RegExp(c + '([-0-9.]+)'));
                    return m ? parseFloat(m[1]) : null;
                };
                
                // Update Feed
                const f = getVal('F');
                if (f !== null) currentFeed = f;
                
                const x = getVal('X'); 
                const y = getVal('Y'); 
                let z = getVal('Z');
                if (z !== null) z += this.zOffset; // Apply offset
                
                if (newType !== currentType && !isArc) {
                    commitPath(currentType);
                    pathPoints = [cur.clone()];
                    currentType = newType;
                }

                const tx = (x !== null) ? x : cur.x;
                const ty = (y !== null) ? y : cur.y;
                const tz = (z !== null) ? z : cur.z;
                
                // Calculate Time and Points
                let dist = 0;
                let moveTime = 0;
                
                if (isArc) {
                    const i = getVal('I') || 0; const j = getVal('J') || 0;
                    const cx = cur.x + i; const cy = cur.y + j;
                    const r = Math.sqrt(i*i + j*j);
                    const startA = Math.atan2(cur.y - cy, cur.x - cx);
                    const endA = Math.atan2(ty - cy, tx - cx);
                    let diff = endA - startA;
                    if (arcDir === 3 && diff <= 0) diff += Math.PI * 2;
                    if (arcDir === 2 && diff >= 0) diff -= Math.PI * 2;
                    
                    // Arc Length
                    // Helix? Z moves too?
                    // Approx distance: ArcLength on XY + Z move?
                    // d = sqrt( (r*theta)^2 + dz^2 )
                    const arcLen = Math.abs(diff * r);
                    const zLen = Math.abs(tz - cur.z);
                    dist = Math.sqrt(arcLen*arcLen + zLen*zLen);
                    
                    const segs = 16;
                    for (let s = 1; s <= segs; s++) {
                        const t = s / segs;
                        const theta = startA + diff * t;
                        const px = cx + r * Math.cos(theta);
                        const py = cy + r * Math.sin(theta);
                        const pz = cur.z + (tz - cur.z) * t;
                        const pVec = new THREE.Vector3(px, py, pz);
                        
                        pathPoints.push(pVec);
                        const last = this.animationPath[this.animationPath.length-1];
                        const dSeg = last.pos.distanceTo(pVec);
                        this.animationPath.push({ pos: pVec, type: newType, dist: dSeg, lineIndex: lineIdx });
                    }
                } else {
                    const tVec = new THREE.Vector3(tx, ty, tz);
                    pathPoints.push(tVec);
                    dist = cur.distanceTo(tVec);
                    this.animationPath.push({ pos: tVec, type: newType, dist: dist, lineIndex: lineIdx });
                }
                
                // Calculate Speed
                let speed = currentFeed;
                if (newType === 'G0') {
                    // Rapid
                    const xyMove = (Math.abs(tx - cur.x) > 0.001 || Math.abs(ty - cur.y) > 0.001);
                    speed = xyMove ? rapidXY : rapidZ;
                }
                
                moveTime = dist / speed; // Minutes
                totalMinutes += moveTime;
                
                // Pass Time Logic (Cutting Only)
                // Use original Z depth logic relative to stock top?
                // Cutting is usually below Z=0 (raw G-code).
                // So if raw z (tz - offset) < 0.
                if (newType !== 'G0' && (tz - this.zOffset) < 0.001) { 
                    // Group by Z level (rounded raw Z)
                    const zKey = (tz - this.zOffset).toFixed(2);
                    const t = layerTimes.get(zKey) || 0;
                    layerTimes.set(zKey, t + moveTime);
                }
                
                cur.set(tx, ty, tz);
            }
        });
        commitPath(currentType);
        
        // Reset Simulation
        this.stop();
        if(this.animationPath.length > 0)
            this.toolMesh.position.copy(this.animationPath[0].pos);
            
        // Calculate Avg Pass Time
        let avgPass = 0;
        if (layerTimes.size > 0) {
            let sum = 0;
            layerTimes.forEach(v => sum += v);
            avgPass = sum / layerTimes.size;
        }
        
        return { totalTime: totalMinutes, avgPassTime: avgPass };
    }

    onProgress(cb) {
        this.progressCallback = cb;
    }

    // Animation Control
    play() {
        this.isPlaying = true;
        this.toolMesh.visible = true;
    }
    pause() {
        this.isPlaying = false;
    }
    stop() {
        this.isPlaying = false;
        this.currentIndex = 0;
        this.progress = 0;
        if(this.animationPath.length > 0)
            this.toolMesh.position.copy(this.animationPath[0].pos);
        if (this.progressCallback) this.progressCallback(0);
        
        // Reset Solid Stock?
        // Maybe not reset, user might want to see result.
        // But if they start over, they probably want a fresh stock.
        // For now, manual reset via Init button is safer.
    }
    skipEnd() {
        this.isPlaying = false;
        this.currentIndex = this.animationPath.length - 2; // End
        this.progress = 1;
        this.updateToolPos();
    }
    setSpeed(mult) {
        this.speedMultiplier = mult;
    }

    updateAnimation(dt) {
        if (this.currentIndex >= this.animationPath.length - 1) {
            this.pause();
            return;
        }

        const startNode = this.animationPath[this.currentIndex];
        const endNode = this.animationPath[this.currentIndex + 1];
        
        // Calculate move speed (mm/sec)
        // Visual speed: 1000mm/min = 16.6 mm/sec
        // Apply multiplier
        let speed = (this.baseSpeed / 60) * this.speedMultiplier;
        
        // Rapids are faster?
        if (endNode.type === 'G0') speed *= 5;

        // Distance to cover this frame
        const distToCover = speed * dt;
        const segmentDist = endNode.dist;
        
        // Convert to progress increment
        const progressInc = distToCover / segmentDist;
        
        this.progress += progressInc;
        
        // --- Carving Logic ---
        if (this.isSolidMode && endNode.type !== 'G0') {
            // Only carve if not Rapid
            // And only if actually playing/moving
            // Interpolate position is handled in updateToolPos, 
            // but we need to carve the path swept.
            // For simplicity, just carve at the current tool position.
            // High speed might skip spots, but sweeping is expensive.
            // "Show how each pass would cut" -> Carving at tool tip is enough for now.
            // We might want to carve at start AND end of this frame's movement to reduce gaps.
        }
        // ---------------------

        if (this.progress >= 1) {
            this.progress = 0;
            this.currentIndex++;
            // Check overflow
            if (this.currentIndex >= this.animationPath.length - 1) {
                this.pause();
                return;
            }
            // Notify Progress
            if (this.progressCallback) {
                const idx = this.animationPath[this.currentIndex].lineIndex;
                if (idx !== undefined) this.progressCallback(idx);
            }
        }
        
        this.updateToolPos();
    }

    updateToolPos() {
        if (this.currentIndex >= this.animationPath.length - 1) return;
        const p1 = this.animationPath[this.currentIndex].pos;
        const p2 = this.animationPath[this.currentIndex + 1].pos;
        this.toolMesh.position.lerpVectors(p1, p2, this.progress);
        
        if (this.isSolidMode) {
             const type = this.animationPath[this.currentIndex + 1].type;
             if (type !== 'G0') {
                 this.carve(this.toolMesh.position);
             }
        }
    }
}
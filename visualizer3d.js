import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// Theme Colors
const COLOR_STOCK = 0xdddddd;
const COLOR_RAPID = 0xff0000;
const COLOR_FEED = 0x0000ff;
const COLOR_GRID = 0x888888;
const COLOR_BG = 0x0b0b10;
const COLOR_TOOL = 0xffff00; // Yellow tool

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
        const axes = new THREE.AxesHelper(20);
        this.scene.add(axes);

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
        this.updateStock(params);
        return this.parseGCode(gcode, params);
    }

    updateStock(params) {
        if (this.stockMesh) this.scene.remove(this.stockMesh);

        const w = params.stockWidth || 100;
        const h = params.stockHeight || 100;
        const t = params.stockThickness || 1;

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

        this.stockMesh.position.set(shiftX, shiftY, -t/2);
        this.scene.add(this.stockMesh);
    }

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
        let cur = new THREE.Vector3(0, 0, 5);
        this.animationPath.push({ pos: cur.clone(), type: 'start', dist: 0 });

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
                
                const x = getVal('X'); const y = getVal('Y'); const z = getVal('Z');
                
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
                if (newType !== 'G0' && tz < 0.001) { // Assuming Z0 is top of stock
                    // Group by Z level (rounded)
                    const zKey = tz.toFixed(2);
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
    }
}
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

let scene, camera, renderer, controls;
let toolpathGroup, stockMesh, axesHelper;
let container;
let isInitialized = false;

// Theme Colors
const COLOR_STOCK = 0xdddddd;
const COLOR_RAPID = 0xff0000; // Red
const COLOR_FEED = 0x0000ff;  // Blue
const COLOR_GRID = 0x888888;
const COLOR_BG = 0x0b0b10; // Matches CSS

export function init3D(domContainer) {
    container = domContainer;
    
    // Scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(COLOR_BG);

    // Camera
    const aspect = container.clientWidth / container.clientHeight;
    camera = new THREE.PerspectiveCamera(50, aspect, 0.1, 1000);
    camera.position.set(0, -100, 100); // Isometric-ish view
    camera.up.set(0, 0, 1); // Z is up

    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(renderer.domElement);

    // Controls
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controls.screenSpacePanning = true;

    // Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);
    
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(50, -50, 100);
    scene.add(dirLight);

    // Initial Objects
    toolpathGroup = new THREE.Group();
    scene.add(toolpathGroup);

    // Grid Helper (XY Plane)
    const grid = new THREE.GridHelper(500, 50, COLOR_GRID, 0x444444);
    grid.rotation.x = Math.PI / 2; // Rotate to lie on XY plane (Z-up)
    scene.add(grid);

    // Axes
    axesHelper = new THREE.AxesHelper(20);
    scene.add(axesHelper);

    isInitialized = true;
    animate();
    
    // Resize Listener
    window.addEventListener('resize', onResize);
}

function onResize() {
    if (!camera || !renderer || !container) return;
    // Check if container is visible/has size
    if (container.clientWidth === 0) return;
    
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
}

// Exported to allow manual trigger when tab becomes visible
export function resize3D() {
    onResize();
}

function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
}

export function update3D(gcode, params) {
    if (!isInitialized) return;

    // 1. Update Stock
    updateStock(params);

    // 2. Parse and Draw G-Code
    drawToolpath(gcode);
}

function updateStock(params) {
    if (stockMesh) scene.remove(stockMesh);

    const w = params.stockWidth || 100;
    const h = params.stockHeight || 100;
    const t = params.stockThickness || 1; // Visual thickness if not set

    const geometry = new THREE.BoxGeometry(w, h, t);
    
    // Transparent material
    const material = new THREE.MeshLambertMaterial({
        color: COLOR_STOCK,
        transparent: true,
        opacity: 0.3,
        side: THREE.DoubleSide
    });

    stockMesh = new THREE.Mesh(geometry, material);
    
    // Position stock
    // Params 'origin' determines where (0,0,0) is relative to stock
    // Our visualizer keeps (0,0,0) at World Origin.
    // So we need to shift the stock mesh so that World Origin matches the selected Job Origin.
    
    // Stock Center (local) is (0,0,0) of the mesh.
    // If Job Origin is "stock-center", Stock Mesh Pos should be (0,0, -t/2). (Top surface at Z=0)
    
    let shiftX = 0;
    let shiftY = 0;
    const originVal = params.origin || 'stock-center';
    
    // If origin is "stock-bottom-left", it means (0,0) is at Bottom-Left.
    // So Stock Center is at (+w/2, +h/2).
    
    // Parse Origin similar to ui.js logic
    let pos = 'center';
    if (originVal.startsWith('stock-')) pos = originVal.replace('stock-', '');
    else if (originVal.startsWith('shape-')) pos = 'center'; // Simplify shape origin to center for stock viz for now, or assume stock centered on shape

    if (pos === 'bottom-left') { shiftX = w/2; shiftY = h/2; }
    else if (pos === 'bottom-right') { shiftX = -w/2; shiftY = h/2; }
    else if (pos === 'top-left') { shiftX = w/2; shiftY = -h/2; }
    else if (pos === 'top-right') { shiftX = -w/2; shiftY = -h/2; }
    // center: shift = 0

    stockMesh.position.set(shiftX, shiftY, -t/2); 
    scene.add(stockMesh);
}

function drawToolpath(gcode) {
    // Clear old lines
    while(toolpathGroup.children.length > 0){
        const child = toolpathGroup.children[0];
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
        toolpathGroup.remove(child); 
    }

    const lines = gcode.split('\n');
    
    let curX = 0, curY = 0, curZ = 5; // Start at Safe Z assumption
    
    let pathPoints = [];
    let currentType = 'G0'; // G0 or G1

    const commitPath = (type) => {
        if (pathPoints.length < 2) return;
        
        const geometry = new THREE.BufferGeometry().setFromPoints(pathPoints);
        const material = new THREE.LineBasicMaterial({ 
            color: type === 'G0' ? COLOR_RAPID : COLOR_FEED,
            opacity: type === 'G0' ? 0.5 : 1.0,
            transparent: type === 'G0'
        });
        const line = new THREE.Line(geometry, material);
        toolpathGroup.add(line);
    };

    pathPoints.push(new THREE.Vector3(curX, curY, curZ));

    lines.forEach(line => {
        line = line.trim().toUpperCase();
        // Remove comments
        if (line.includes(';')) line = line.split(';')[0].trim();
        if (!line) return;

        // Detect Command
        let isMove = false;
        let newType = currentType;
        let isArc = false;
        let arcDir = 0; // 2=CW, 3=CCW

        if (line.startsWith('G0') || line.startsWith('G00')) {
            newType = 'G0';
            isMove = true;
        } else if (line.startsWith('G1') || line.startsWith('G01')) {
            newType = 'G1';
            isMove = true;
        } else if (line.startsWith('G2') || line.startsWith('G02')) {
            newType = 'G1';
            isMove = true;
            isArc = true;
            arcDir = 2; // Treat arc as feed
        } else if (line.startsWith('G3') || line.startsWith('G03')) {
            newType = 'G1';
            isMove = true;
            isArc = true;
            arcDir = 3;
        }

        if (isMove) {
            // Parse Coords
            const getVal = (char) => {
                const regex = new RegExp(char + '([-0-9.]+)');
                const match = line.match(regex);
                return match ? parseFloat(match[1]) : null;
            };

            const x = getVal('X');
            const y = getVal('Y');
            const z = getVal('Z');
            
            // Check if type changed
            if (newType !== currentType && !isArc) {
                commitPath(currentType);
                pathPoints = [new THREE.Vector3(curX, curY, curZ)]; // Start new path from current
                currentType = newType;
            }

            const targetX = (x !== null) ? x : curX;
            const targetY = (y !== null) ? y : curY;
            const targetZ = (z !== null) ? z : curZ;

            if (isArc) {
                // Approximate Arc
                // Need I, J
                const i = getVal('I') || 0;
                const j = getVal('J') || 0;
                
                // Center relative to start (curX, curY)
                const centerX = curX + i;
                const centerY = curY + j;
                
                // Radius
                const radius = Math.sqrt(i*i + j*j);
                
                // Angles
                const startAngle = Math.atan2(curY - centerY, curX - centerX);
                const endAngle = Math.atan2(targetY - centerY, targetX - centerX);
                
                // Calculate angular span
                let diff = endAngle - startAngle;
                
                // Handle direction and wrap
                if (arcDir === 3) { // CCW (G3)
                    if (diff <= 0) diff += Math.PI * 2;
                } else { // CW (G2)
                    if (diff >= 0) diff -= Math.PI * 2;
                }
                
                // Segments
                const segments = 16;
                for (let s = 1; s <= segments; s++) {
                    const t = s / segments;
                    const theta = startAngle + diff * t;
                    const px = centerX + radius * Math.cos(theta);
                    const py = centerY + radius * Math.sin(theta);
                    // Interpolate Z (Spiral)
                    const pz = curZ + (targetZ - curZ) * t;
                    pathPoints.push(new THREE.Vector3(px, py, pz));
                }
            } else {
                // Linear
                pathPoints.push(new THREE.Vector3(targetX, targetY, targetZ));
            }

            curX = targetX;
            curY = targetY;
            curZ = targetZ;
        }
    });

    // Commit final path
    commitPath(currentType);
}

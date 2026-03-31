// API Configuration
const API_KEY = "6A2FddUNck3phNAi34P2tGqc";
const API_URL = "https://api.remove.bg/v1.0/removebg";

// DOM Elements
const dropZone = document.getElementById('drop-zone');
const filepicker = document.getElementById('filepicker');
const fileNameDisplay = document.getElementById('file-name');
const uploadBtn = document.getElementById('upload-btn');
const uploadBtnText = document.getElementById('upload-btn-text');
const editorTools = document.getElementById('editor-tools');

const resultContainer = document.getElementById('result-container');
const outputPlaceholder = document.getElementById('output-placeholder');
const canvasWrapper = document.getElementById('canvas-wrapper');
const loadingOverlay = document.getElementById('loading-overlay');
const actionBar = document.getElementById('action-bar');
const downloadBtn = document.getElementById('download-btn');
const resetBtn = document.getElementById('reset-btn');

const contactForm = document.getElementById('contactForm');

// State
let currentFile = null;
let processedImageURL = null;
let canvas = null;
let userImageObj = null;

// Initialization
document.addEventListener("DOMContentLoaded", () => {
  setupNavbar();
  setupDragAndDrop();
  setupFileUpload();
  setupActionButtons();
  setupContactForm();
  setupEditorTools();
  
  // Enable delete key for canvas items
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Backspace' || e.key === 'Delete') {
      if (canvas) {
        const activeObject = canvas.getActiveObject();
        if (activeObject && activeObject !== userImageObj) {
          canvas.remove(activeObject);
          showToast('Layer removed', 'info');
        }
      }
    }
  });
});

// --- Editor Tools Logic ---
function initCanvas(imgUrl) {
  if (canvas) {
    canvas.dispose();
  }
  
  // Create responsive fabric canvas
  // Initial size will be 600x600 for high res editing area
  canvas = new fabric.Canvas('editor-canvas', {
    width: 600,
    height: 600,
    backgroundColor: null,
    preserveObjectStacking: true
  });
  
  // Allow canvas to scale down via CSS
  const canvasEl = document.querySelector('.canvas-container');
  canvasEl.style.maxWidth = '100%';
  canvasEl.style.height = 'auto';

  fabric.Image.fromURL(imgUrl, function(img) {
    // Scale image to fit canvas comfortably
    const scale = Math.min((canvas.width * 0.9) / img.width, (canvas.height * 0.9) / img.height);
    img.set({
      scaleX: scale,
      scaleY: scale,
      left: canvas.width / 2,
      top: canvas.height / 2,
      originX: 'center',
      originY: 'center',
      cornerColor: '#d946ef',
      cornerStrokeColor: '#ffffff',
      borderColor: '#d946ef',
      cornerSize: 12,
      transparentCorners: false
    });
    
    userImageObj = img;
    canvas.add(img);
    canvas.centerObject(img);
    canvas.setActiveObject(img);
    canvas.renderAll();
  });
}

function setupEditorTools() {
  // Background Colors
  const colorBtns = document.querySelectorAll('.color-btn');
  const colorPicker = document.getElementById('custom-color-picker');
  
  colorBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      // Manage active visual state
      colorBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      const color = btn.getAttribute('data-color');
      changeCanvasBackground(color);
    });
  });

  colorPicker.addEventListener('input', (e) => {
    colorBtns.forEach(b => b.classList.remove('active'));
    changeCanvasBackground(e.target.value);
  });

  // Canvas Dimensions
  const sizeBtns = document.querySelectorAll('.size-btn');
  sizeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      sizeBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      const ratio = btn.getAttribute('data-ratio');
      if (ratio === 'original' && userImageObj) {
        // Reset to user image dimensions
        resizeCanvas(userImageObj.width * userImageObj.scaleX, userImageObj.height * userImageObj.scaleY);
      } else {
        const w = parseInt(btn.getAttribute('data-width'));
        const h = parseInt(btn.getAttribute('data-height'));
        resizeCanvas(w, h);
      }
    });
  });
}

function changeCanvasBackground(color) {
  if (!canvas) return;
  canvas.setBackgroundColor(color === 'transparent' ? null : color, canvas.renderAll.bind(canvas));
  showToast('Background updated', 'info');
}

function resizeCanvas(width, height) {
  if (!canvas) return;
  // Center existing objects relative to new canvas size
  const oldWidth = canvas.width;
  const oldHeight = canvas.height;
  
  canvas.setWidth(width);
  canvas.setHeight(height);
  
  // Realistically we want to keep objects roughly centered
  const offsetX = (width - oldWidth) / 2;
  const offsetY = (height - oldHeight) / 2;
  
  canvas.getObjects().forEach(obj => {
    obj.set({
      left: obj.left + offsetX,
      top: obj.top + offsetY
    });
    obj.setCoords();
  });
  
  canvas.renderAll();
  showToast(`Sized to ${width}x${height}`, 'success');
}


// --- API & UI Logic ---
function setupNavbar() {
  const navbar = document.getElementById('navbar');
  const burger = document.getElementById('burger');
  const menu = document.getElementById('menu');
  const navLinks = document.querySelectorAll('.nav-link');

  window.addEventListener('scroll', () => {
    if (window.scrollY > 50) {
      navbar.classList.add('scrolled');
    } else {
      navbar.classList.remove('scrolled');
    }
  });

  burger.addEventListener('click', () => {
    burger.classList.toggle('active');
    menu.classList.toggle('active');
  });

  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
      e.preventDefault();
      burger.classList.remove('active');
      menu.classList.remove('active');
      navLinks.forEach(link => link.classList.remove('active'));
      if(this.classList.contains('nav-link')) {
        this.classList.add('active');
      }
      const targetId = this.getAttribute('href');
      if (targetId === '#') return;
      const targetElement = document.querySelector(targetId);
      if (targetElement) {
        window.scrollTo({
          top: targetElement.offsetTop - 70,
          behavior: 'smooth'
        });
      }
    });
  });
}

function setupDragAndDrop() {
  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, preventDefaults, false);
    document.body.addEventListener(eventName, preventDefaults, false);
  });
  ['dragenter', 'dragover'].forEach(eventName => {
    dropZone.addEventListener(eventName, () => dropZone.classList.add('dragover'), false);
  });
  ['dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, () => dropZone.classList.remove('dragover'), false);
  });
  dropZone.addEventListener('drop', handleDrop, false);
}

function preventDefaults(e) {
  e.preventDefault();
  e.stopPropagation();
}

function handleDrop(e) {
  const dt = e.dataTransfer;
  const files = dt.files;
  handleFiles(files);
}

function setupFileUpload() {
  filepicker.addEventListener('change', function() {
    handleFiles(this.files);
  });
}

function handleFiles(files) {
  if (files.length === 0) return;
  const file = files[0];
  if (!file.type.match('image.*')) {
    showToast('Please select a valid image file.', 'error');
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    showToast('Image is too large. Max 10MB.', 'error');
    return;
  }
  currentFile = file;
  fileNameDisplay.textContent = file.name;
  uploadBtn.disabled = false;
  uploadBtnText.textContent = "Remove Background & Edit";
}

function setupActionButtons() {
  uploadBtn.addEventListener('click', processImage);
  downloadBtn.addEventListener('click', downloadResult);
  resetBtn.addEventListener('click', resetApp);
}

async function processImage() {
  if (!currentFile) {
    showToast('Please select an image first.', 'info');
    return;
  }

  uploadBtn.disabled = true;
  uploadBtn.classList.add('btn-loading');
  loadingOverlay.classList.remove('hidden');
  outputPlaceholder.classList.add('hidden');
  canvasWrapper.classList.add('hidden');
  actionBar.classList.add('hidden');
  editorTools.classList.add('hidden');
  
  if (processedImageURL) {
    URL.revokeObjectURL(processedImageURL);
    processedImageURL = null;
  }

  try {
    const formData = new FormData();
    formData.append("image_file", currentFile);
    formData.append("size", "auto");

    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'X-Api-Key': API_KEY,
      },
      body: formData
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.errors?.[0]?.title || `Status ${response.status}`);
    }

    const blob = await response.blob();
    processedImageURL = URL.createObjectURL(blob);
    
    // Load into canvas
    canvasWrapper.classList.remove('hidden');
    initCanvas(processedImageURL);
    
    // Show UI
    loadingOverlay.classList.add('hidden');
    actionBar.classList.remove('hidden');
    editorTools.classList.remove('hidden');
    
    uploadBtnText.textContent = "Process Next Image";
    showToast('Background cleared! Now customize your photo.', 'success');
  } catch (error) {
    console.error('API Error:', error);
    showToast(`Correction failed: ${error.message}`, 'error');
    loadingOverlay.classList.add('hidden');
    outputPlaceholder.classList.remove('hidden');
  } finally {
    uploadBtn.classList.remove('btn-loading');
    uploadBtn.disabled = false;
  }
}

function downloadResult() {
  if (!canvas) return;
  
  // Deselect objects so selection boxes don't render in download
  canvas.discardActiveObject();
  canvas.renderAll();
  
  const dataURL = canvas.toDataURL({
    format: 'png',
    multiplier: 1 // Quality multiplier if we want HD export
  });
  
  const a = document.createElement('a');
  a.href = dataURL;
  a.download = `pro_photo_${new Date().getTime()}.png`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  
  showToast('Photo Saved Successfully!', 'success');
}

function resetApp() {
  currentFile = null;
  filepicker.value = '';
  fileNameDisplay.textContent = '';
  uploadBtn.disabled = true;
  uploadBtnText.textContent = "Remove Background & Edit";
  
  if (processedImageURL) {
    URL.revokeObjectURL(processedImageURL);
    processedImageURL = null;
  }
  
  if (canvas) {
    canvas.dispose();
    canvas = null;
  }
  
  canvasWrapper.classList.add('hidden');
  actionBar.classList.add('hidden');
  editorTools.classList.add('hidden');
  outputPlaceholder.classList.remove('hidden');
  
  showToast('Editor reset.', 'info');
}

function setupContactForm() {
  contactForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = document.getElementById('name').value;
    const btn = contactForm.querySelector('button[type="submit"]');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Sending...';
    btn.disabled = true;
    
    setTimeout(() => {
      showToast(`Thanks ${name}! Your message has been routed to our ether.`, 'success');
      contactForm.reset();
      btn.innerHTML = originalText;
      btn.disabled = false;
    }, 1500);
  });
}

function showToast(message, type = 'info') {
  const toast = document.getElementById('toast');
  const toastMsg = document.getElementById('toast-message');
  const toastIcon = document.getElementById('toast-icon');
  
  toast.className = 'toast show';
  toast.classList.add(type);
  if (type === 'success') toastIcon.className = 'fa-solid fa-check-circle';
  else if (type === 'error') toastIcon.className = 'fa-solid fa-circle-exclamation';
  else toastIcon.className = 'fa-solid fa-circle-info';
  toastMsg.textContent = message;
  
  if (window.toastTimeout) {
    clearTimeout(window.toastTimeout);
  }
  window.toastTimeout = setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => {
      toast.className = 'toast hidden';
    }, 400);
  }, 4000);
}

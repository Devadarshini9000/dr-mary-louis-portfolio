const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

// Cloudinary configuration
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Configure Cloudinary
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
})
.then(() => console.log('MongoDB Connected'))
.catch(err => console.log('MongoDB Connection Error:', err));

// Content Schema (for Curriculum and Hobbies)
const contentSchema = new mongoose.Schema({
    title: { type: String, required: true },
    description: { type: String, required: true },
    fileUrl: { type: String, required: true },
    fileType: { type: String, required: true },
    publicId: { type: String, required: true }, // Cloudinary public ID for deletion
    category: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

const Content = mongoose.model('Content', contentSchema);

// Project Schema (for Student Projects)
const projectSchema = new mongoose.Schema({
    projectTitle: { type: String, required: true },
    studentName: { type: String, required: true },
    rollNo: { type: String, required: true },
    department: { type: String, required: true },
    year: { type: String, required: true },
    description: { type: String, required: true },
    fileUrl: { type: String, required: true },
    fileType: { type: String, required: true },
    publicId: { type: String, required: true }, // Cloudinary public ID for deletion
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

const Project = mongoose.model('Project', projectSchema);

// Configure Cloudinary Storage for Multer
const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: async (req, file) => {
        // Determine folder based on file type
        let folder = 'portfolio';
        if (req.baseUrl.includes('projects')) {
            folder = 'portfolio/projects';
        } else if (req.body.category === 'curriculum') {
            folder = 'portfolio/curriculum';
        } else if (req.body.category === 'hobbies') {
            folder = 'portfolio/hobbies';
        }

        // Determine resource type
        let resourceType = 'auto';
        if (file.mimetype.startsWith('video/')) {
            resourceType = 'video';
        } else if (file.mimetype.startsWith('image/')) {
            resourceType = 'image';
        } else {
            resourceType = 'raw'; // For PDFs and documents
        }

        return {
            folder: folder,
            resource_type: resourceType,
            allowed_formats: ['jpg', 'jpeg', 'png', 'gif', 'mp4', 'webm', 'pdf', 'doc', 'docx'],
            transformation: file.mimetype.startsWith('image/') ? [
                { width: 1200, height: 1200, crop: 'limit' }
            ] : undefined
        };
    }
});

const fileFilter = (req, file, cb) => {
    const allowedTypes = [
        'image/jpeg', 'image/png', 'image/gif', 
        'video/mp4', 'video/webm', 
        'application/pdf', 
        'application/msword', 
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('Invalid file type. Only images, videos, PDFs, and Word documents are allowed.'), false);
    }
};

const upload = multer({ 
    storage: storage,
    fileFilter: fileFilter,
    limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

// Authentication middleware
const authenticate = (req, res, next) => {
    const password = req.headers['x-admin-password'];
    if (password === process.env.ADMIN_PASSWORD) {
        next();
    } else {
        res.status(401).json({ error: 'Unauthorized' });
    }
};

// Helper function to delete file from Cloudinary
async function deleteFromCloudinary(publicId, resourceType = 'image') {
    try {
        await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
        console.log(`Deleted file from Cloudinary: ${publicId}`);
    } catch (error) {
        console.error('Error deleting from Cloudinary:', error);
    }
}

// Helper function to determine resource type from file type
function getResourceType(fileType) {
    if (fileType.startsWith('video/')) return 'video';
    if (fileType.startsWith('image/')) return 'image';
    return 'raw';
}

// ============== CONTENT ROUTES (Curriculum & Hobbies) ==============

// Get all content by category
app.get('/api/content/:category', async (req, res) => {
    try {
        const content = await Content.find({ category: req.params.category }).sort({ createdAt: -1 });
        res.json(content);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get single content item
app.get('/api/content/item/:id', async (req, res) => {
    try {
        const content = await Content.findById(req.params.id);
        if (!content) {
            return res.status(404).json({ error: 'Content not found' });
        }
        res.json(content);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Create new content (protected)
app.post('/api/content', authenticate, upload.single('file'), async (req, res) => {
    try {
        const { title, description, category } = req.body;
        
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const newContent = new Content({
            title,
            description,
            fileUrl: req.file.path, // Cloudinary URL
            fileType: req.file.mimetype,
            publicId: req.file.filename, // Cloudinary public ID
            category
        });

        await newContent.save();
        res.status(201).json(newContent);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update content (protected)
app.put('/api/content/:id', authenticate, upload.single('file'), async (req, res) => {
    try {
        const { title, description } = req.body;
        const content = await Content.findById(req.params.id);

        if (!content) {
            return res.status(404).json({ error: 'Content not found' });
        }

        content.title = title || content.title;
        content.description = description || content.description;
        content.updatedAt = Date.now();

        if (req.file) {
            // Delete old file from Cloudinary
            await deleteFromCloudinary(content.publicId, getResourceType(content.fileType));

            // Update with new file
            content.fileUrl = req.file.path;
            content.fileType = req.file.mimetype;
            content.publicId = req.file.filename;
        }

        await content.save();
        res.json(content);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete content (protected)
app.delete('/api/content/:id', authenticate, async (req, res) => {
    try {
        const content = await Content.findById(req.params.id);

        if (!content) {
            return res.status(404).json({ error: 'Content not found' });
        }

        // Delete file from Cloudinary
        await deleteFromCloudinary(content.publicId, getResourceType(content.fileType));

        // Delete from database
        await Content.findByIdAndDelete(req.params.id);
        res.json({ message: 'Content deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============== PROJECT ROUTES ==============

// Get all projects
app.get('/api/projects', async (req, res) => {
    try {
        const projects = await Project.find().sort({ createdAt: -1 });
        res.json(projects);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get single project
app.get('/api/projects/:id', async (req, res) => {
    try {
        const project = await Project.findById(req.params.id);
        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }
        res.json(project);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Create new project (protected)
app.post('/api/projects', authenticate, upload.single('file'), async (req, res) => {
    try {
        const { projectTitle, studentName, rollNo, department, year, description } = req.body;
        
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const newProject = new Project({
            projectTitle,
            studentName,
            rollNo,
            department,
            year,
            description,
            fileUrl: req.file.path, // Cloudinary URL
            fileType: req.file.mimetype,
            publicId: req.file.filename // Cloudinary public ID
        });

        await newProject.save();
        res.status(201).json(newProject);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update project (protected)
app.put('/api/projects/:id', authenticate, upload.single('file'), async (req, res) => {
    try {
        const { projectTitle, studentName, rollNo, department, year, description } = req.body;
        const project = await Project.findById(req.params.id);

        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }

        project.projectTitle = projectTitle || project.projectTitle;
        project.studentName = studentName || project.studentName;
        project.rollNo = rollNo || project.rollNo;
        project.department = department || project.department;
        project.year = year || project.year;
        project.description = description || project.description;
        project.updatedAt = Date.now();

        if (req.file) {
            // Delete old file from Cloudinary
            await deleteFromCloudinary(project.publicId, getResourceType(project.fileType));

            // Update with new file
            project.fileUrl = req.file.path;
            project.fileType = req.file.mimetype;
            project.publicId = req.file.filename;
        }

        await project.save();
        res.json(project);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete project (protected)
app.delete('/api/projects/:id', authenticate, async (req, res) => {
    try {
        const project = await Project.findById(req.params.id);

        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }

        // Delete file from Cloudinary
        await deleteFromCloudinary(project.publicId, getResourceType(project.fileType));

        // Delete from database
        await Project.findByIdAndDelete(req.params.id);
        res.json({ message: 'Project deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============== ADMIN VERIFICATION ==============

// Verify admin password
app.post('/api/verify-admin', (req, res) => {
    const { password } = req.body;
    if (password === process.env.ADMIN_PASSWORD) {
        res.json({ valid: true });
    } else {
        res.json({ valid: false });
    }
});

// ============== HEALTH CHECK ==============

app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        cloudinary: cloudinary.config().cloud_name ? 'Connected' : 'Not configured',
        mongodb: mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected'
    });
});

// ============== SERVE STATIC FILES ==============

// Serve index.html for root route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handling middleware
app.use((error, req, res, next) => {
    console.error('Error:', error);
    res.status(error.status || 500).json({
        error: error.message || 'Internal Server Error'
    });
});

const PORT = process.env.PORT || 3002;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Cloudinary configured: ${cloudinary.config().cloud_name || 'Not configured'}`);
});
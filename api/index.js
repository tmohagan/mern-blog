const express = require('express');
const cors = require('cors');
const mongoose = require("mongoose");
const { ObjectId } = require('mongoose').Types;
const User = require('./models/User');
const Post = require('./models/Post');
const Project = require('./models/Project');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const uploadMiddleware = multer({ dest: '/tmp' });
const {S3Client, PutObjectCommand, DeleteObjectCommand} = require('@aws-sdk/client-s3');
const fs = require('fs');
const nodemailer = require('nodemailer');

require('dotenv').config();
const app = express();

const salt = bcrypt.genSaltSync(10);
const secret = 'asdfe45we45w345wegw345werjktjwertkj';
const bucket = 'ohagan-mern-blog';

const allowedOrigins = [
  'https://www.tim-ohagan.com',
  'http://localhost:3000'
];

const corsOptions = {
  origin: (origin, callback) => {
    if (allowedOrigins.indexOf(origin) !== -1 || !origin) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions)); 

app.use(express.json());
app.use(cookieParser());
app.use('/uploads', express.static(__dirname + '/uploads'));

async function uploadToS3(path, originalFilename, mimetype) {
  const client = new S3Client({
    region: 'us-east-2',
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    },
  });
  const parts = originalFilename.split('.');
  const ext = parts[parts.length -1];
  const newFilename = Date.now() + '.' + ext;
  const data = await client.send(new PutObjectCommand({
    Bucket: bucket,
    Body: fs.readFileSync(path),
    Key: newFilename,
    ContentType: mimetype,
    ACL: 'public-read',
  }));
  return `https://${bucket}.s3.amazonaws.com/${newFilename}`;
}

app.get('/test', (req,res) => {
  res.json('ok');
}
);

app.post('/register', async (req, res) => {
  mongoose.connect(process.env.MONGO_URL);

  const { username, password, confirmPassword } = req.body;
  
  if (password !== confirmPassword) {
    return res.status(400).json({ error: 'Passwords do not match' });
  }

  try {
    const userDoc = await User.create({
      username,
      password: bcrypt.hashSync(password, salt),
    });
    res.json(userDoc);
  } catch (e) {
    res.status(400).json({ error: 'Registration failed', details: e.message });
  }
});

app.post('/login', async (req, res) => {
  try {
    await mongoose.connect(process.env.MONGO_URL); 
    const { username, password } = req.body;
    const userDoc = await User.findOne({ username });

    if (!userDoc) {
      return res.status(400).json('Wrong credentials');
    }

    const passOk = bcrypt.compareSync(password, userDoc.password);

    if (passOk) {
      jwt.sign({ username, id: userDoc._id }, secret, {}, (err, token) => {
        if (err) throw err;

        const cookieOptions = {
          httpOnly: true,
          sameSite: 'none',
          secure: true,
          maxAge: 24 * 60 * 60 * 1000,
        };

        res.cookie('token', token, cookieOptions).json({
          id: userDoc._id,
          username,
        });
      });
    } else {
      res.status(400).json('Wrong credentials');
    }
  } catch (error) {
    console.error('Error during login:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.get('/profile', (req, res) => {
  const { token } = req.cookies;
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized - No Token' });
  }
  jwt.verify(token, secret, {}, (err, info) => {
    if (err) {
      console.error('Unauthorized - Error verifying token:', err);
      return res.status(401).json({ error: 'Invalid Token' });
    }
    res.json(info);
  });
});

app.get('/user/:id', async (req, res) => {
  mongoose.connect(process.env.MONGO_URL);
  const {id} = req.params;
  const userDoc = await User.findById(id);
  res.json(userDoc);
})


app.put('/user', async (req, res) => {
  try {
    mongoose.connect(process.env.MONGO_URL);

    const { token } = req.cookies;

    jwt.verify(token, secret, {}, async (err, info) => {
      if (err) {
        return res.status(403).json({ error: 'Invalid token' });
      }

      const { id, name } = req.body;

      if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ error: 'Invalid user ID' });
      }

      const userDoc = await User.findById(id);
      if (!userDoc) {
        return res.status(404).json({ error: 'User not found' });
      }

      if (userDoc._id.toString() !== info.id) {
        return res.status(403).json({ error: 'Unauthorized to update this user' });
      }

      const updateFields = { name };
      if (name) userDoc.name = name;

      await userDoc.save();

      res.json(userDoc);
    });
  } catch (error) {
    console.error('Error updating user:', error);

    if (error.name === 'CastError' && error.kind === 'ObjectId') {
      return res.status(400).json({ error: 'Invalid user ID format' });
    }
    
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/logout', (req,res) => {
  res.cookie('token', '').json('ok');
});

app.post('/contact', express.json(), async (req, res) => {
  try {
    const { name, email, message } = req.body;

    if (!name || !email || !message) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT,
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD,
      },
    });

    const mailOptions = {
      from: process.env.SMTP_FROM_EMAIL || 'tmohagan@gmail.com',
      to: 'tmohagan@gmail.com',
      subject: `New message from ${name}`,
      text: `
        Name: ${name}
        Email: ${email}
        Message: ${message}
      `,
    };

    await transporter.sendMail(mailOptions);

    res.json({ success: true });
  } catch (error) {
    console.error('Error sending email:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

app.post('/post', uploadMiddleware.single('file'), async (req,res) => {
  mongoose.connect(process.env.MONGO_URL);

  let imageUrl = null;

  if (req.file) {
    const { originalname, path, mimetype } = req.file;
    imageUrl = await uploadToS3(path, originalname, mimetype);
  }


  const {token} = req.cookies;
  jwt.verify(token, secret, {}, async (err,info) => {
    if (err) {
      throw err;
    }
    const {title,summary,content} = req.body;
    const postDoc = await Post.create({
      title,
      summary,
      content,
      cover:imageUrl,
      author:info.id,
    });
    res.json(postDoc);
  });
});

app.put('/post',uploadMiddleware.single('file'), async (req,res) => {
  mongoose.connect(process.env.MONGO_URL);
  let imageUrl = null;
  if (req.file) {
    const {originalname, path, mimetype} = req.file;
    imageUrl = await uploadToS3(path, originalname, mimetype);
  }

  const {token} = req.cookies;
  jwt.verify(token, secret, {}, async (err,info) => {
    if (err) throw err;
    const {id,title,summary,content} = req.body;
    const postDoc = await Post.findById(id);
    const isAuthor = JSON.stringify(postDoc.author) === JSON.stringify(info.id);
    if (!isAuthor) {
      return res.status(400).json('you are not the author');
    }
    await postDoc.updateOne({
      title,
      summary,
      content,
      cover: imageUrl ? imageUrl : postDoc.cover,
    });

    res.json(postDoc);
  });

});

app.get('/post', async (req,res) => {
  mongoose.connect(process.env.MONGO_URL);
  res.json(
    await Post.find()
      .populate('author', ['username'])
      .sort({createdAt: -1})
      .limit(20)
  );
});

app.get('/post/:id', async (req, res) => {
  mongoose.connect(process.env.MONGO_URL);
  const {id} = req.params;
  const postDoc = await Post.findById(id).populate('author', ['username']);
  res.json(postDoc);
})

app.delete('/post/:id', async (req, res) => {
  try {
    mongoose.connect(process.env.MONGO_URL);
    const { id } = req.params;

    const postDoc = await Post.findById(id);
    if (!postDoc) {
      return res.status(404).json({ error: 'Post not found' });
    }

    const { token } = req.cookies;
    jwt.verify(token, secret, {}, async (err, info) => {
      if (err) {
        return res.status(403).json({ error: 'Invalid token' });
      }

      if (!postDoc.author.equals(info.id)) {
        return res.status(403).json({ error: 'Unauthorized to delete this post' });
      }

      if (postDoc.cover) {
        const imageUrlParts = postDoc.cover.split('/');
        const imageName = imageUrlParts[imageUrlParts.length - 1];

        const client = new S3Client({
          region: 'us-east-2',
          credentials: {
            accessKeyId: process.env.S3_ACCESS_KEY,
            secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
          },
        });
        await client.send(new DeleteObjectCommand({
          Bucket: bucket,
          Key: imageName,
        }));
      }

      await Post.findByIdAndDelete(id); 

      res.json({ success: true });
    });
  } catch (error) {
    console.error('Error deleting post:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/project', uploadMiddleware.single('file'), async (req,res) => {
  mongoose.connect(process.env.MONGO_URL);

  let imageUrl = null;

  if (req.file) {
    const { originalname, path, mimetype } = req.file;
    imageUrl = await uploadToS3(path, originalname, mimetype);
  }


  const {token} = req.cookies;
  jwt.verify(token, secret, {}, async (err,info) => {
    if (err) {
      throw err;
    }
    const {title,summary,content} = req.body;
    const projectDoc = await Project.create({
      title,
      summary,
      content,
      cover:imageUrl,
      author:info.id,
    });
    res.json(projectDoc);
  });
});

app.put('/project',uploadMiddleware.single('file'), async (req,res) => {
  mongoose.connect(process.env.MONGO_URL);
  let imageUrl = null;
  if (req.file) {
    const {originalname, path, mimetype} = req.file;
    imageUrl = await uploadToS3(path, originalname, mimetype);
  }

  const {token} = req.cookies;
  jwt.verify(token, secret, {}, async (err,info) => {
    if (err) throw err;
    const {id,title,summary,content} = req.body;
    const projectDoc = await Project.findById(id);
    const isAuthor = JSON.stringify(projectDoc.author) === JSON.stringify(info.id);
    if (!isAuthor) {
      return res.status(400).json('you are not the author');
    }
    await projectDoc.updateOne({
      title,
      summary,
      content,
      cover: imageUrl ? imageUrl : projectDoc.cover,
    });

    res.json(projectDoc);
  });

});

app.get('/project', async (req,res) => {
  mongoose.connect(process.env.MONGO_URL);
  res.json(
    await Project.find()
      .populate('author', ['username'])
      .sort({createdAt: -1})
      .limit(20)
  );
});

app.get('/project/:id', async (req, res) => {
  mongoose.connect(process.env.MONGO_URL);
  const {id} = req.params;
  const projectDoc = await Project.findById(id).populate('author', ['username']);
  res.json(projectDoc);
})

app.delete('/project/:id', async (req, res) => {
  try {
    mongoose.connect(process.env.MONGO_URL);
    const { id } = req.params;

    const projectDoc = await Project.findById(id);
    if (!projectDoc) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const { token } = req.cookies;
    jwt.verify(token, secret, {}, async (err, info) => {
      if (err) {
        return res.status(403).json({ error: 'Invalid token' });
      }

      if (!projectDoc.author.equals(info.id)) {
        return res.status(403).json({ error: 'Unauthorized to delete this project' });
      }

      if (projectDoc.cover) {
        const imageUrlParts = projectDoc.cover.split('/');
        const imageName = imageUrlParts[imageUrlParts.length - 1];

        const client = new S3Client({
          region: 'us-east-2',
          credentials: {
            accessKeyId: process.env.S3_ACCESS_KEY,
            secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
          },
        });
        await client.send(new DeleteObjectCommand({
          Bucket: bucket,
          Key: imageName,
        }));
      }

      await Project.findByIdAndDelete(id); 

      res.json({ success: true });
    });
  } catch (error) {
    console.error('Error deleting project:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

if (process.env.API_PORT) {
  app.listen(process.env.API_PORT);
}

module.exports = app;

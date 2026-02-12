# RTU Result Analyzer

Production-grade RTU result processing system with PDF parsing, accurate SGPA logic, subject matching, and a modern frontend. Includes Vercel serverless API and Cloudinary uploads.

**Highlights**
- Upload RTU marksheet PDFs
- Extract metadata, subjects, marks/grades
- Match against master subjects and credit catalog
- Compute SGPA using RTU rules
- Export a styled PDF summary
- Optional Cloudinary storage for uploaded files

---

## Tech Stack
- Node.js (CommonJS)
- Express + Mongoose
- pdf-parse
- Cloudinary (optional)
- Frontend: HTML, CSS, JS (no framework)
- Vercel serverless API

---

## Project Structure
- `backend/` Express app, parsers, DB models
- `frontend/` UI
- `api/` Vercel serverless functions
- `vercel.json` Vercel routes

---

## Local Setup

1. Install dependencies
```
cd C:\Users\deepa\OneDrive\Desktop\CALCULATOR\backend
npm install
```

2. Create `backend/.env`
```
MONGO_URI=mongodb://localhost:27017/rtu_results
MIN_TEXT_LENGTH=120
```

3. (Optional) Cloudinary
```
CLOUDINARY_CLOUD_NAME=your_cloud
CLOUDINARY_API_KEY=your_key
CLOUDINARY_API_SECRET=your_secret
```

4. Seed subjects (optional)
```
node seedSubjects.js
```

5. Run backend
```
node server.js
```

6. Open frontend
- Local: open `frontend/index.html`
- Recommended: `http://localhost:5000` (served by backend)

---

## API

**POST** `/api/result/calculate`  
**Body:** `multipart/form-data`  
**Field:** `result` (PDF)

**Response**
```
{
  "rollNo": "...",
  "name": "...",
  "branch": "...",
  "semester": 4,
  "sgpa": 8.72,
  "cgpa": null,
  "percentage": null,
  "division": null,
  "totalCredits": 23.5,
  "totalGradePoints": 205,
  "subjects": [
    {
      "subject": "Discrete Mathematics",
      "subjectCode": "4IT2-01",
      "credits": 3,
      "marks": 66,
      "grade": "B",
      "gradePoint": 7.5,
      "contribution": 22.5
    }
  ],
  "fileUrl": "https://res.cloudinary.com/.../file.pdf"
}
```

---

## Vercel Deployment (Serverless)

1. Push repo to GitHub
2. Import into Vercel
3. Root Directory: **repo root**
4. Set Environment Variables:
```
MONGO_URI=...
CLOUDINARY_CLOUD_NAME=... (optional)
CLOUDINARY_API_KEY=... (optional)
CLOUDINARY_API_SECRET=... (optional)
MIN_TEXT_LENGTH=120 (optional)
```

**Frontend URL**
```
https://your-app.vercel.app
```

**API URL**
```
https://your-app.vercel.app/api/result/calculate
```

The frontend calls `/api/result/calculate` directly, so the backend host is hidden from users.

---

## PDF Notes
- Text-based PDFs work best.
- Scanned PDFs are not supported. Please upload a text-based PDF.

---

## Security
- Do **not** commit `.env`
- Add to `.gitignore`:
```
.env
backend/.env
```

---

## License
Private project (no license specified).

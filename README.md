# ClearDesk Automation Dashboard

Static website ready for deployment.

## Pages

- `index.html` - Main dashboard landing page
- `login.html` - Staff login page
- `agent-detail.html` - Agent profile and details
- `team-management.html` - Team management interface
- `developer-portal.html` - API and developer tools
- `style-guide.html` - Design system and components

## Deployment

### Quick Start (Local)
```bash
python -m http.server 8000
# Visit http://localhost:8000
```

### Vercel
```bash
vercel --prod
```

### Netlify
Drag and drop the entire folder to Netlify or:
```bash
netlify deploy --prod
```

### GitHub Pages
1. Push to GitHub repo
2. Enable Pages in Settings
3. Select main branch

## Design System

- Framework: Tailwind CSS (CDN)
- Typography: Plus Jakarta Sans
- Icons: Material Symbols
- Theme: Glassmorphic Material Design 3
- Colors: Purple-blue primary, light gradient background

## Browser Support

Modern browsers with backdrop-filter support:
- Chrome/Edge 76+
- Firefox 103+
- Safari 9+

No build step required - pure HTML/CSS/JS.

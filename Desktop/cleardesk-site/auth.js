// Enhanced Authentication Library with RBAC Support
// Replace your existing auth.js with this version

// Role hierarchy (highest to lowest)
const ROLES = {
  DEVELOPER: 'DEVELOPER',
  ORG_ADMIN: 'ORG_ADMIN',
  ORG_STAFF: 'ORG_STAFF'
};

const ROLE_HIERARCHY = [ROLES.DEVELOPER, ROLES.ORG_ADMIN, ROLES.ORG_STAFF];

// Get current authenticated user with profile data
async function getCurrentUser() {
  try {
    const { data: { session }, error } = await supabaseClient.auth.getSession();
    
    if (error || !session) {
      return null;
    }

    // Extract custom claims from JWT
    const { user } = session;
    const claims = user.user_metadata || {};
    
    // Get role from JWT claims (set by auth hook)
    const role = user.role || session.user.app_metadata?.user_role || 'ORG_STAFF';
    const organizationId = session.user.app_metadata?.organization_id;
    const preferredLanguage = session.user.app_metadata?.preferred_language || 'ENGLISH';
    const displayName = session.user.app_metadata?.display_name || user.email;

    // If role not in JWT, fetch from database (fallback)
    let userProfile = {
      role,
      organization_id: organizationId,
      preferred_language: preferredLanguage,
      display_name: displayName
    };

    if (!role || !organizationId) {
      const { data: profile } = await supabaseClient
        .from('user_profiles')
        .select('*, organizations(name, subdomain)')
        .eq('id', user.id)
        .single();
      
      if (profile) {
        userProfile = profile;
      }
    }

    return {
      id: user.id,
      email: user.email,
      role: userProfile.role,
      organization_id: userProfile.organization_id,
      preferred_language: userProfile.preferred_language,
      display_name: userProfile.display_name,
      organization: userProfile.organizations || null
    };
  } catch (error) {
    console.error('Error getting current user:', error);
    return null;
  }
}

// Check if user has required role
function hasRole(user, allowedRoles) {
  if (!user || !user.role) return false;
  
  // Convert single role to array
  const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];
  
  // Check if user's role is in allowed roles
  return roles.includes(user.role);
}

// Check if user has minimum role level
function hasMinimumRole(user, minimumRole) {
  if (!user || !user.role) return false;
  
  const userRoleIndex = ROLE_HIERARCHY.indexOf(user.role);
  const minimumRoleIndex = ROLE_HIERARCHY.indexOf(minimumRole);
  
  // Lower index = higher role
  return userRoleIndex <= minimumRoleIndex;
}

// Require specific role(s) or redirect
async function requireRole(allowedRoles, redirectUrl = '/login.html') {
  const user = await getCurrentUser();
  
  if (!user || !hasRole(user, allowedRoles)) {
    window.location.href = redirectUrl;
    return null;
  }
  
  return user;
}

// Require minimum role level or redirect
async function requireMinimumRole(minimumRole, redirectUrl = '/login.html') {
  const user = await getCurrentUser();
  
  if (!user || !hasMinimumRole(user, minimumRole)) {
    window.location.href = redirectUrl;
    return null;
  }
  
  return user;
}

// Sign up new user
async function signUp(email, password, displayName, preferredLanguage = 'ENGLISH') {
  const { data, error } = await supabaseClient.auth.signUp({
    email,
    password,
    options: {
      data: {
        display_name: displayName,
        preferred_language: preferredLanguage
      }
    }
  });

  if (error) throw error;

  // User profile will be created by database trigger
  return data;
}

// Sign in user
async function signIn(email, password) {
  const { data, error } = await supabaseClient.auth.signInWithPassword({
    email,
    password
  });

  if (error) throw error;
  return data;
}

// Sign out user
async function signOut() {
  const { error } = await supabaseClient.auth.signOut();
  if (error) throw error;
  window.location.href = '/login.html';
}

// Update user's preferred language
async function updateLanguage(language) {
  const user = await getCurrentUser();
  if (!user) return;

  const { error } = await supabaseClient
    .from('user_profiles')
    .update({ preferred_language: language })
    .eq('id', user.id);

  if (error) throw error;
  
  // Refresh session to update JWT claims
  await supabaseClient.auth.refreshSession();
}

// Get IST-based greeting
function getGreeting(userName) {
  const now = new Date();
  // Convert to IST (UTC+5:30)
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istTime = new Date(now.getTime() + istOffset);
  const hour = istTime.getUTCHours();

  let greeting;
  if (hour < 12) {
    greeting = 'Good Morning';
  } else if (hour < 17) {
    greeting = 'Good Afternoon';
  } else if (hour < 21) {
    greeting = 'Good Evening';
  } else {
    greeting = 'Working late';
  }

  return `${greeting}, ${userName}!`;
}

// Get role badge color
function getRoleBadgeClass(role) {
  switch (role) {
    case ROLES.DEVELOPER:
      return 'bg-purple-100 text-purple-800 border-purple-200';
    case ROLES.ORG_ADMIN:
      return 'bg-blue-100 text-blue-800 border-blue-200';
    case ROLES.ORG_STAFF:
      return 'bg-green-100 text-green-800 border-green-200';
    default:
      return 'bg-gray-100 text-gray-800 border-gray-200';
  }
}

// Format role for display
function formatRole(role) {
  switch (role) {
    case ROLES.DEVELOPER:
      return 'Developer';
    case ROLES.ORG_ADMIN:
      return 'Admin';
    case ROLES.ORG_STAFF:
      return 'Staff';
    default:
      return role;
  }
}

// Check if user is authenticated
async function isAuthenticated() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  return !!session;
}

// Protect page (require authentication)
async function protectPage(redirectUrl = '/login.html') {
  const authenticated = await isAuthenticated();
  if (!authenticated) {
    window.location.href = redirectUrl;
    return null;
  }
  return getCurrentUser();
}
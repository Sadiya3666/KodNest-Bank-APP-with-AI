import axios from 'axios';

// Dynamic API URL based on environment
const API_BASE_URL = process.env.REACT_APP_API_URL || 
  (window.location.origin === 'http://localhost:3000' 
    ? 'http://localhost:5000/api' 
    : `${window.location.origin}/api`);

// Create axios instance
const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 10000, // 10 seconds timeout
});

// Request interceptor - Add auth token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor - Handle common errors
api.interceptors.response.use(
  (response) => {
    return response;
  },
  (error) => {
    // Handle 401 Unauthorized - token expired or invalid
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }
    
    // Handle network errors
    if (!error.response) {
      error.message = 'Network error. Please check your connection.';
    }
    
    return Promise.reject(error);
  }
);

// Generic API request methods
export const apiRequest = {
  get: (url, config = {}) => api.get(url, config),
  post: (url, data = {}, config = {}) => api.post(url, data, config),
  put: (url, data = {}, config = {}) => api.put(url, data, config),
  delete: (url, config = {}) => api.delete(url, config),
};

// Utility function to handle API errors
export const handleApiError = (error) => {
  // Check for response data errors
  if (error.response?.data) {
    const data = error.response.data;
    
    // Check various common error message locations
    if (typeof data.message === 'string') return data.message;
    if (typeof data.error === 'string') return data.error;
    if (data.error && typeof data.error.message === 'string') return data.error.message;
    if (Array.isArray(data.details) && data.details.length > 0) {
      if (typeof data.details[0].message === 'string') return data.details[0].message;
    }
  }
  
  // Check for Axios error message
  if (error.message) return error.message;
  
  return 'An unexpected error occurred';
};

export default api;

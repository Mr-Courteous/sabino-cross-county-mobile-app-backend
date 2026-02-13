/**
 * Password Validation Utility for Backend
 * Enforces strict password requirements for both schools and students
 */

/**
 * Validates password against strict requirements:
 * - At least one uppercase letter
 * - At least one lowercase letter
 * - At least one number
 * - At least one special symbol
 * - Minimum 8 characters
 * 
 * @param {string} password - The password to validate
 * @returns {Object} - { isValid: boolean, error: string }
 */
function validatePassword(password) {
    if (!password || typeof password !== 'string') {
        return {
            isValid: false,
            error: 'Password is required'
        };
    }

    const requirements = [];

    if (password.length < 8) {
        requirements.push('at least 8 characters');
    }

    if (!/[A-Z]/.test(password)) {
        requirements.push('one uppercase letter (A-Z)');
    }

    if (!/[a-z]/.test(password)) {
        requirements.push('one lowercase letter (a-z)');
    }

    if (!/[0-9]/.test(password)) {
        requirements.push('one number (0-9)');
    }

    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
        requirements.push('one special symbol (!@#$%^&*)');
    }

    if (requirements.length > 0) {
        return {
            isValid: false,
            error: `Password must include: ${requirements.join(', ')}`
        };
    }

    return {
        isValid: true,
        error: ''
    };
}

module.exports = {
    validatePassword
};

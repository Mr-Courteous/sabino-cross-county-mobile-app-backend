import { Stack } from 'expo-router';

export default function StudentLayout() {
    return (
        <Stack
            screenOptions={{
                headerShown: false,
            }}
        >
            <Stack.Screen name="index" options={{ title: 'Student Login' }} />
            <Stack.Screen name="verify-email" options={{ title: 'Verify Email' }} />
            <Stack.Screen name="verify-otp" options={{ title: 'Verify OTP' }} />
            <Stack.Screen name="forgot-password" options={{ title: 'Forgot Password' }} />
            <Stack.Screen name="verify-reset-otp" options={{ title: 'Enter Reset Code' }} />
            <Stack.Screen name="reset-password" options={{ title: 'New Password' }} />
            <Stack.Screen name="register" options={{ title: 'Complete Profile' }} />
            <Stack.Screen name="dashboard" options={{ title: 'Student Dashboard' }} />
            <Stack.Screen name="grades" options={{ title: 'My Grades' }} />
            <Stack.Screen name="preferences" options={{ title: 'Preferences' }} />
        </Stack>
    );
}

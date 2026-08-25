import { View, TextInput, TouchableOpacity, Text, ActivityIndicator, ScrollView, Alert, Platform, FlatList } from 'react-native';
import { useState, useEffect, useRef } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { API_BASE_URL } from '@/utils/api-service';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { validatePassword } from '@/utils/password-validator';
import { PayWithFlutterwave } from 'flutterwave-react-native';

export default function CompleteRegistrationScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();

  const email = params.email as string;
  const isMobilePlatform = Platform.OS === 'android' || Platform.OS === 'ios';

  const [countries, setCountries] = useState<Array<{ id: number, code: string, name: string, description: string }>>([]);
  const [showCountryDropdown, setShowCountryDropdown] = useState(false);
  const [loadingCountries, setLoadingCountries] = useState(true);
  const [countriesError, setCountriesError] = useState('');

  // REGISTRATION STEP MANAGEMENT
  const [currentStep, setCurrentStep] = useState<'form' | 'payment'>('form');
  const [registrationData, setRegistrationData] = useState<any>(null);

  // Store schoolId and token for the listener to use
  const schoolContext = useRef<{ schoolId: string | null, token: string | null }>({ schoolId: null, token: null });

  const [formData, setFormData] = useState({
    password: '',
    confirmPassword: '',
    firstName: '',
    lastName: '',
    phone: '',
    schoolName: '',
    schoolType: 'private',
    country: '',
    countryId: null as number | null,
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // BILLING STATE
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);
  const [billingError, setBillingError] = useState('');
  const [isResumingPayment, setIsResumingPayment] = useState(false);
  const [checkingAccount, setCheckingAccount] = useState(true);

  const showError = (title: string, message: any) => {
    console.log(`[API ERROR] ${title}:`, message);
    Alert.alert(
      title,
      typeof message === 'string'
        ? message
        : message?.message || JSON.stringify(message)
    );
  };

  const checkAccountStatus = async () => {
    if (!email) return;
    
    console.log(`[CHECK] Checking account for: ${email} at ${API_BASE_URL}/api/schools/otp`);
    try {
      setCheckingAccount(true);
      const response = await fetch(`${API_BASE_URL}/api/schools/otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();
      console.log(`[CHECK] Result:`, result);

      if (result.alreadyRegistered) {
        if (result.resumePayment) {
          console.log("[CHECK] Found pending payment, resuming...");
          setIsResumingPayment(true);
          // Pre-fill some data if available
          if (result.data) {
            setFormData(prev => ({
              ...prev,
              schoolName: result.data.name || prev.schoolName,
            }));
            schoolContext.current = { 
              schoolId: result.data.schoolId, 
              token: null // We'll get a token when they try to "Continue" or login
            };
          }
          // Move to payment step automatically if they are resuming
          setCurrentStep('payment');
        } else if (result.data?.paymentStatus === 'completed') {
          Alert.alert("Already Active", "This school is already active. Please login.", [
            { text: "Go to Login", onPress: () => router.replace('/(auth)') }
          ]);
        }
      }
    } catch (err: any) {
      console.log("[CHECK] Network/CORS Error:", err);
      // Don't block the UI with an alert on mount check, just log it
      setBillingError("Could not connect to server. Check your internet or API URL.");
    } finally {
      // Add a slight delay for better UX
      setTimeout(() => setCheckingAccount(false), 800);
    }
  };

  const fetchCountries = async () => {
    try {
      setLoadingCountries(true);
      console.log(`[FETCH] Loading countries from ${API_BASE_URL}/api/auth/countries`);
      const response = await fetch(`${API_BASE_URL}/api/auth/countries`);
      const data = await response.json();
      if (data.success && Array.isArray(data.data)) {
        setCountries(data.data);
      } else {
        setCountriesError('Failed to load countries');
      }
    } catch (err) {
      console.error('[FETCH] Countries error:', err);
      setCountriesError('Error fetching countries list');
    } finally {
      setLoadingCountries(false);
    }
  };

  useEffect(() => {
    fetchCountries();
    checkAccountStatus();
  }, []);

  const handleFlutterwaveVerification = async (transactionId: string) => {
    setIsProcessingPayment(true);
    try {
      const { schoolId, token } = schoolContext.current;
      console.log(`[VERIFY] Verifying transaction ${transactionId} for school ${schoolId}`);
      
      const response = await fetch(`${API_BASE_URL}/api/schools/${schoolId}/verify-flutterwave`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ transaction_id: transactionId })
      });

      if (response.ok) {
        Alert.alert("Success", "Account Activated! Welcome aboard.");
        router.replace('/dashboard');
      } else {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Backend verification failed");
      }
    } catch (err: any) {
      showError("Sync Error", "Payment received but account update failed. Please contact support.");
    } finally {
      setIsProcessingPayment(false);
    }
  };

  const validateForm = () => {
    if (!formData.country.trim()) { setError('Please select a country'); return false; }
    if (!formData.schoolName.trim()) { setError('School name is required'); return false; }
    if (!formData.password.trim()) { setError('Password is required'); return false; }
    const passwordValidation = validatePassword(formData.password);
    if (!passwordValidation.isValid) { setError(passwordValidation.errorMessage); return false; }
    if (formData.password !== formData.confirmPassword) { setError('Passwords do not match'); return false; }
    if (!formData.firstName.trim()) { setError('First name is required'); return false; }
    if (!formData.lastName.trim()) { setError('Last name is required'); return false; }
    return true;
  };

  const handleCompleteRegistration = async () => {
    if (!validateForm()) return;

    setLoading(true);
    setError('');

    try {
      console.log(`[POST] Registering/Updating account at ${API_BASE_URL}/api/schools`);
      const regData = {
        email,
        password: formData.password,
        firstName: formData.firstName,
        lastName: formData.lastName,
        phone: formData.phone || undefined,
        name: formData.schoolName,
        school_type: formData.schoolType,
        country: formData.country,
        countryId: formData.countryId,
      };

      const response = await fetch(`${API_BASE_URL}/api/schools`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...regData, paymentStatus: 'pending' }),
      });

      const responseData = await response.json();
      if (!response.ok) {
        throw new Error(responseData.error || responseData.message || 'Account creation failed');
      }

      console.log(`[POST] Registered successfully:`, responseData.data);
      const accountData = responseData.data;
      const schoolId = accountData.user?.schoolId;
      const token = responseData.token;

      schoolContext.current = { schoolId, token };
      setIsResumingPayment(!!responseData.resumePayment);
      setRegistrationData(regData);
      setCurrentStep('payment');
    } catch (err: any) {
      console.error("[POST] Error:", err);
      showError('Registration Error', err.message || 'Check your internet connection');
      setError(err.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  const handleBackToForm = () => {
    setCurrentStep('form');
    setBillingError('');
    setIsResumingPayment(false);
  };

  return (
    <ThemedView style={{ flex: 1 }}>
      {checkingAccount && (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(255,255,255,0.95)', justifyContent: 'center', alignItems: 'center', zIndex: 999 }}>
          <ActivityIndicator size="large" color="#4CAF50" />
          <ThemedText style={{ marginTop: 12, fontWeight: '600', color: '#4CAF50' }}>Resuming your account...</ThemedText>
        </View>
      )}

      <ScrollView style={{ flex: 1, padding: 20 }} contentContainerStyle={{ paddingBottom: 60 }}>
        {currentStep === 'form' && (
          <>
            <View style={{ marginBottom: 30 }}>
              <ThemedText type="title">Complete Registration</ThemedText>
              <ThemedText type="subtitle" style={{ opacity: 0.7 }}>Step 3: Account Details</ThemedText>
            </View>

            {countriesError && (
              <View style={{ backgroundColor: '#fff3cd', padding: 12, borderRadius: 6, marginBottom: 16 }}>
                <ThemedText style={{ color: '#856404' }}>⚠️ {countriesError}</ThemedText>
                <TouchableOpacity onPress={fetchCountries}><ThemedText style={{ color: '#007AFF', marginTop: 5 }}>Retry loading countries</ThemedText></TouchableOpacity>
              </View>
            )}

            {!loadingCountries && countries.length > 0 && (
              <View style={{ marginBottom: 16 }}>
                <ThemedText style={{ marginBottom: 6, fontWeight: '600' }}>Country *</ThemedText>
                <TouchableOpacity
                  style={{ borderWidth: 1, borderColor: '#ddd', borderRadius: 6, padding: 12, backgroundColor: '#fff', flexDirection: 'row', justifyContent: 'space-between' }}
                  onPress={() => setShowCountryDropdown(!showCountryDropdown)}
                >
                  <ThemedText style={{ color: formData.country ? '#000' : '#999' }}>{formData.country || 'Select your country'}</ThemedText>
                  <ThemedText>{showCountryDropdown ? '▲' : '▼'}</ThemedText>
                </TouchableOpacity>

                {showCountryDropdown && (
                  <View style={{ borderWidth: 1, borderColor: '#ddd', backgroundColor: '#fff', maxHeight: 200, marginTop: -1 }}>
                    <FlatList
                      data={countries}
                      keyExtractor={(item) => String(item.id)}
                      renderItem={({ item }) => (
                        <TouchableOpacity style={{ padding: 12, borderBottomWidth: 1, borderBottomColor: '#eee' }} onPress={() => { setFormData({ ...formData, country: item.name, countryId: item.id }); setShowCountryDropdown(false); }}>
                          <ThemedText>{item.name}</ThemedText>
                        </TouchableOpacity>
                      )}
                    />
                  </View>
                )}
              </View>
            )}

            <View style={{ marginBottom: 16 }}>
              <ThemedText style={{ marginBottom: 6, fontWeight: '600' }}>School Name *</ThemedText>
              <TextInput style={{ borderWidth: 1, borderColor: '#ddd', borderRadius: 6, padding: 10, backgroundColor: '#fff' }} placeholder="My Awesome School" value={formData.schoolName} onChangeText={(text) => setFormData({ ...formData, schoolName: text })} />
            </View>

            <View style={{ marginBottom: 16, flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <ThemedText style={{ marginBottom: 6, fontWeight: '600' }}>First Name *</ThemedText>
                <TextInput style={{ borderWidth: 1, borderColor: '#ddd', borderRadius: 6, padding: 10, backgroundColor: '#fff' }} placeholder="Jane" value={formData.firstName} onChangeText={(text) => setFormData({ ...formData, firstName: text })} />
              </View>
              <View style={{ flex: 1 }}>
                <ThemedText style={{ marginBottom: 6, fontWeight: '600' }}>Last Name *</ThemedText>
                <TextInput style={{ borderWidth: 1, borderColor: '#ddd', borderRadius: 6, padding: 10, backgroundColor: '#fff' }} placeholder="Doe" value={formData.lastName} onChangeText={(text) => setFormData({ ...formData, lastName: text })} />
              </View>
            </View>

            <View style={{ marginBottom: 24 }}>
              <ThemedText style={{ marginBottom: 6, fontWeight: '600' }}>Password *</ThemedText>
              <View style={{ position: 'relative' }}>
                <TextInput secureTextEntry={!showPassword} style={{ borderWidth: 1, borderColor: '#ddd', borderRadius: 6, padding: 10, paddingRight: 45, backgroundColor: '#fff' }} placeholder="Secure Password" value={formData.password} onChangeText={(text) => setFormData({ ...formData, password: text })} />
                <TouchableOpacity style={{ position: 'absolute', right: 10, top: 10, padding: 5 }} onPress={() => setShowPassword(!showPassword)}>
                  <Text style={{ fontSize: 18 }}>{showPassword ? '👁️' : '👁️‍🗨️'}</Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={{ marginBottom: 24 }}>
              <ThemedText style={{ marginBottom: 6, fontWeight: '600' }}>Confirm Password *</ThemedText>
              <View style={{ position: 'relative' }}>
                <TextInput secureTextEntry={!showConfirmPassword} style={{ borderWidth: 1, borderColor: '#ddd', borderRadius: 6, padding: 10, paddingRight: 45, backgroundColor: '#fff' }} placeholder="Repeat Password" value={formData.confirmPassword} onChangeText={(text) => setFormData({ ...formData, confirmPassword: text })} />
                <TouchableOpacity style={{ position: 'absolute', right: 10, top: 10, padding: 5 }} onPress={() => setShowConfirmPassword(!showConfirmPassword)}>
                  <Text style={{ fontSize: 18 }}>{showConfirmPassword ? '👁️' : '👁️‍🗨️'}</Text>
                </TouchableOpacity>
              </View>
            </View>

            {error && <ThemedText style={{ color: '#d32f2f', marginBottom: 16, fontWeight: '600' }}>❌ {error}</ThemedText>}

            <TouchableOpacity 
              style={{ backgroundColor: loading ? '#ccc' : '#4CAF50', padding: 16, borderRadius: 8, alignItems: 'center' }} 
              onPress={handleCompleteRegistration}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <ThemedText style={{ color: '#fff', fontWeight: 'bold', fontSize: 16 }}>Continue to Activation</ThemedText>
              )}
            </TouchableOpacity>
          </>
        )}

        {currentStep === 'payment' && (
          <>
            <View style={{ marginBottom: 30 }}>
              <ThemedText type="title">Activate Subscription</ThemedText>
              <ThemedText type="subtitle" style={{ opacity: 0.7 }}>Secure access via Flutterwave</ThemedText>
            </View>

            {billingError ? (
              <View style={{ backgroundColor: '#ffebee', padding: 20, borderRadius: 8, borderLeftWidth: 5, borderLeftColor: '#d32f2f', marginBottom: 25 }}>
                <ThemedText style={{ color: '#c62828', fontWeight: 'bold', marginBottom: 5 }}>Payment Error</ThemedText>
                <ThemedText style={{ color: '#b71c1c' }}>{billingError}</ThemedText>
              </View>
            ) : null}

            <View style={{ backgroundColor: '#f9f9f9', padding: 20, borderRadius: 12, borderWidth: 1, borderColor: '#ddd', marginBottom: 30 }}>
              <ThemedText style={{ fontSize: 18, fontWeight: 'bold', marginBottom: 10 }}>📱 Sabino School Subscription</ThemedText>
              <ThemedText style={{ fontSize: 24, fontWeight: 'bold', color: '#4CAF50', marginBottom: 10 }}>₦5,000 / month</ThemedText>
              <ThemedText style={{ fontSize: 14, color: '#666', lineHeight: 20 }}>Comprehensive school management features, student registries, and report generation.</ThemedText>
            </View>

            <PayWithFlutterwave
              onRedirect={async (data) => {
                if (data.status === 'successful') {
                  // CALL BACKEND VERIFY ROUTE
                  await handleFlutterwaveVerification(data.transaction_id);
                } else {
                  setBillingError("Payment was not successful. Please try again.");
                }
              }}
              options={{
                tx_ref: `sabino_tx_${Date.now()}_${schoolContext.current.schoolId}`,
                authorization: 'FLWPUBK_TEST-006eb849fc05b0c57df79050a1478936-X', // Update with your actual public key
                amount: 5000,
                currency: 'NGN',
                payment_options: 'card,ussd,banktransfer',
                customer: {
                  email: email,
                  phonenumber: formData.phone,
                  name: `${formData.firstName} ${formData.lastName}`,
                },
                customizations: {
                  title: 'Sabino School Subscription',
                  description: 'Payment for school management platform',
                  logo: 'https://sabino-cross-county-mobile-app-back.vercel.app/logo.png', // Corrected placeholder
                },
              }}
              customButton={(props) => (
                <TouchableOpacity
                  style={{ backgroundColor: props.disabled || isProcessingPayment ? '#ccc' : '#4CAF50', padding: 18, borderRadius: 8, alignItems: 'center' }}
                  onPress={props.onPress}
                  disabled={props.disabled || isProcessingPayment}
                >
                  {isProcessingPayment ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <ThemedText style={{ color: '#fff', fontWeight: 'bold', fontSize: 18 }}>
                      Pay Now with Flutterwave
                    </ThemedText>
                  )}
                </TouchableOpacity>
              )}
            />

            <TouchableOpacity style={{ marginTop: 20, alignItems: 'center' }} onPress={handleBackToForm}>
              <ThemedText style={{ color: '#666' }}>← Change school details</ThemedText>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </ThemedView>
  );
}

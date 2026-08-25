import { View, TextInput, TouchableOpacity, Text, ActivityIndicator, ScrollView, Alert, Platform, FlatList } from 'react-native';
import { useState, useEffect, useRef } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { API_BASE_URL } from '@/utils/api-service';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { validatePassword } from '@/utils/password-validator';
import * as RNIap from 'react-native-iap';
import type { Subscription } from 'react-native-iap';

const SUBSCRIPTION_ID = 'sabino_school_product_id1234';

/** Extract display price from a v13 Subscription object */
function getSubscriptionPrice(sub: Subscription): string {
  // Android Billing Library 5+: price is in subscriptionOfferDetails
  if (Platform.OS === 'android') {
    const phase = sub.subscriptionOfferDetails?.[0]
      ?.pricingPhases?.pricingPhaseList?.[0];
    if (phase?.formattedPrice) return phase.formattedPrice;
  }
  // iOS or fallback: localizedPrice may still exist on some builds
  if ((sub as any).localizedPrice) return (sub as any).localizedPrice;
  return '';
}

export default function CompleteRegistrationScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();

  const email = params.email as string;
  const isMobilePlatform = Platform.OS === 'android' || Platform.OS === 'ios';

  const [countries, setCountries] = useState<Array<{ id: number, code: string, name: string, description: string }>>([]);
  const [showCountryDropdown, setShowCountryDropdown] = useState(false);
  const [loadingCountries, setLoadingCountries] = useState(true);
  const [countriesError, setCountriesError] = useState('');

  // REGISTRATION & FLOW MGMT
  const [currentStep, setCurrentStep] = useState<'form' | 'payment'>('form');
  const [checkingAccount, setCheckingAccount] = useState(true);

  // Store context for IAP listeners to find
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
  const [billingPlan, setBillingPlan] = useState<any>(null);

  const showError = (title: string, message: any) => {
    console.log(`[BIILING ERROR] ${title}:`, message);
    Alert.alert(
      title,
      typeof message === 'string' ? message : (message?.message || JSON.stringify(message))
    );
  };

  const fetchCountries = async () => {
    try {
      setLoadingCountries(true);
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

  const checkAccountStatus = async () => {
    if (!email) return;
    try {
      setCheckingAccount(true);
      const response = await fetch(`${API_BASE_URL}/api/schools/check-status/${encodeURIComponent(email)}`, {
        method: 'GET'
      });
      const result = await response.json();
      if (result.alreadyRegistered) {
        if (result.resumePayment) {
          setIsResumingPayment(true);
          if (result.data) {
            setFormData(prev => ({ ...prev, schoolName: result.data.name || prev.schoolName }));
            schoolContext.current = { schoolId: result.data.schoolId, token: null };
          }
          setCurrentStep('payment');
        } else if (result.data?.paymentStatus === 'completed') {
          Alert.alert("Already Active", "This school is already active. Please login.", [
            { text: "Go to Login", onPress: () => router.replace('/(auth)') }
          ]);
        }
      }
    } catch (err) {
      console.log("[CHECK] Network error on mount:", err);
    } finally {
      setTimeout(() => setCheckingAccount(false), 800);
    }
  };

  const handleServerPurchaseVerification = async (purchase: RNIap.ProductPurchase) => {
    setIsProcessingPayment(true);
    try {
      const { schoolId, token } = schoolContext.current;
      if (!schoolId) {
        throw new Error("School ID is missing for purchase verification.");
      }
      console.log(`[VERIFY] Syncing purchase ${purchase.transactionId} with server...`);

      const response = await fetch(`${API_BASE_URL}/api/schools/${schoolId}/payment-status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          purchaseToken: purchase.transactionReceipt || purchase.purchaseToken,
          payment_status: 'completed',
          subscriptionDetails: purchase
        })
      });

      if (response.ok) {
        await RNIap.finishTransaction({ purchase, isConsumable: false });
        Alert.alert("Success", "Account Activated! Welcome aboard.");
        router.replace('/dashboard');
      } else {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || "Backend verification failed");
      }
    } catch (err: any) {
      showError("Sync Error", "Your purchase was successful, but we couldn't update your account yet. Please contact support.");
    } finally {
      setIsProcessingPayment(false);
    }
  };

  const initializeBilling = async () => {
    try {
      setLoading(true);
      setBillingError('');
      console.log("[RNIap] Initializing connection...");

      // v13: call setup() if available (no-op on older builds)
      if (typeof (RNIap as any).setup === 'function') {
        await (RNIap as any).setup({ storekitMode: 'STOREKIT2_MODE' });
      }

      const connected = await RNIap.initConnection();
      console.log("[RNIap] initConnection result:", connected);

      if (Platform.OS === 'android') {
        await RNIap.flushFailedPurchasesCachedAsPendingAndroid();
      }

      console.log("[RNIap] Connection successful. Fetching subscriptions...");
      const productIds = [SUBSCRIPTION_ID];
      const products = await RNIap.getSubscriptions({ skus: productIds });

      console.log("[RNIap] getSubscriptions skus=", productIds);
      console.log("[RNIap] Products found:", products?.length || 0);
      if (products.length > 0) {
        console.log("[RNIap] First product keys:", Object.keys(products[0]));
        console.log("[RNIap] subscriptionOfferDetails:", JSON.stringify(products[0].subscriptionOfferDetails, null, 2));
      }

      if (products.length > 0) {
        setBillingPlan(products[0]);
        const price = getSubscriptionPrice(products[0]);
        console.log("[RNIap] Extracted price:", price);
      } else {
        setBillingError(`Product "${SUBSCRIPTION_ID}" not found in store. Ensure it is active in Play Console / App Store Connect.`);
      }
      return true;
    } catch (err: any) {
      console.error("[RNIap] initializeBilling error:", err);
      setBillingError(`Could not connect to ${Platform.OS === 'ios' ? 'App Store' : 'Google Play'}: ${err.message || err}`);
      return false;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCountries();
    checkAccountStatus();

    let purchaseUpdateSub: { remove: () => void } | undefined;
    let purchaseErrorSub: { remove: () => void } | undefined;

    const startIAPFlow = async () => {
      console.log("[RNIap] Available Methods:", Object.keys(RNIap));
      if (isMobilePlatform) {
        // Register listeners BEFORE initConnection so we don't miss events
        purchaseUpdateSub = RNIap.purchaseUpdatedListener(async (purchase: any) => {
          const item = Array.isArray(purchase) ? purchase[0] : purchase;
          if (item) {
            console.log('[RNIap] Purchase Updated:', item.transactionId);
            const receipt = item.transactionReceipt || item.purchaseToken;
            if (receipt) {
              await handleServerPurchaseVerification(item);
            }
          }
        });

        purchaseErrorSub = RNIap.purchaseErrorListener((error: any) => {
          console.log('[RNIap] Purchase Error:', error);
          setIsProcessingPayment(false);
          if (error.code !== 'E_USER_CANCELLED') {
            showError('Purchase Failed', error.message);
          }
        });

        await initializeBilling();
      }
    };

    startIAPFlow();

    return () => {
      purchaseUpdateSub?.remove();
      purchaseErrorSub?.remove();
      RNIap.endConnection();
    };
  }, []);

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

      console.log(`[POST] Registered/Updated:`, responseData.data);
      const accountData = responseData.data;
      const schoolId = accountData.user?.schoolId;
      const token = responseData.token;

      schoolContext.current = { schoolId, token };
      setIsResumingPayment(!!responseData.resumePayment);
      setCurrentStep('payment');
    } catch (err: any) {
      setError(err.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  const handlePurchase = async () => {
    if (!isMobilePlatform) {
      Alert.alert("Platform Not Supported", "Billing is only supported on Android or iOS devices.");
      return;
    }

    // 1. Bulletproof check for native module existence
    if (typeof RNIap.requestSubscription !== 'function') {
      console.error("[RNIap] CRITICAL: requestSubscription is undefined. Native module not correctly linked in this build.");
      Alert.alert("Store Module Error", "The in-app billing module is not correctly loaded in this app build. Please rebuild the app.");
      return;
    }

    if (!billingPlan) {
      Alert.alert("Store Message", "Subscription plan not loaded from store. Please wait a moment while we re-connect.");
      await initializeBilling();
      return;
    }

    setIsProcessingPayment(true);
    try {
      console.log("[RNIap] Requesting subscription for:", SUBSCRIPTION_ID);

      // For Android Subscriptions (v12+ / Billing Library 5+), we MUST use subscriptionOffers
      if (Platform.OS === 'android') {
        const offerToken = billingPlan.subscriptionOfferDetails?.[0]?.offerToken;

        if (!offerToken) {
          throw new Error("No offer token found for this subscription. Check if the product is 'Active' in Google Play Console.");
        }

        console.log("[RNIap] Requesting with token:", offerToken);
        await RNIap.requestSubscription({
          subscriptionOffers: [{
            sku: SUBSCRIPTION_ID,
            offerToken: offerToken
          }]
        });
      } else {
        // iOS still uses the simple sku
        await RNIap.requestSubscription({ sku: SUBSCRIPTION_ID });
      }
    } catch (err: any) {
      setIsProcessingPayment(false);
      showError('Subscription Error', err);
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
          <ThemedText style={{ marginTop: 12, fontWeight: '600', color: '#4CAF50' }}>Preparing registration...</ThemedText>
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
                  <View style={{ borderWidth: 1, borderColor: '#ddd', backgroundColor: '#fff', maxHeight: 200, marginTop: -1, zIndex: 1000 }}>
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

            {error ? <ThemedText style={{ color: '#d32f2f', marginBottom: 16, fontWeight: '600' }}>❌ {error}</ThemedText> : null}

            <TouchableOpacity
              style={{ backgroundColor: loading ? '#ccc' : '#4CAF50', padding: 16, borderRadius: 8, alignItems: 'center' }}
              onPress={handleCompleteRegistration}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <ThemedText style={{ color: '#fff', fontWeight: 'bold', fontSize: 16 }}>Continue to Payment</ThemedText>
              )}
            </TouchableOpacity>
          </>
        )}

        {currentStep === 'payment' && (
          <>
            <View style={{ marginBottom: 30 }}>
              <ThemedText type="title">Activate Subscription</ThemedText>
              <ThemedText type="subtitle" style={{ opacity: 0.7 }}>Secure access via Google Play</ThemedText>
            </View>

            {billingError ? (
              <View style={{ backgroundColor: '#ffebee', padding: 20, borderRadius: 8, borderLeftWidth: 5, borderLeftColor: '#d32f2f', marginBottom: 25 }}>
                <ThemedText style={{ color: '#c62828', fontWeight: 'bold', marginBottom: 5 }}>Store Error</ThemedText>
                <ThemedText style={{ color: '#b71c1c' }}>{billingError}</ThemedText>
                <TouchableOpacity onPress={initializeBilling} style={{ marginTop: 10 }}><ThemedText style={{ color: '#007AFF' }}>Retry connecting to store</ThemedText></TouchableOpacity>
              </View>
            ) : null}

            <View style={{ backgroundColor: '#f9f9f9', padding: 20, borderRadius: 12, borderWidth: 1, borderColor: '#ddd', marginBottom: 30 }}>
              <ThemedText style={{ fontSize: 18, fontWeight: 'bold', marginBottom: 10 }}>📱 Sabino School Portal</ThemedText>
              <ThemedText style={{ fontSize: 24, fontWeight: 'bold', color: '#4CAF50', marginBottom: 10 }}>
                {billingPlan ? (getSubscriptionPrice(billingPlan) || '₦5,000') : '₦5,000'} / month
              </ThemedText>
              <ThemedText style={{ fontSize: 14, color: '#666', lineHeight: 20 }}>
                {billingPlan?.description || 'Get full access to school management features, student registries, and report generation.'}
              </ThemedText>
            </View>

            <TouchableOpacity
              style={{ padding: 18, borderRadius: 8, alignItems: 'center', backgroundColor: isProcessingPayment || !isMobilePlatform ? '#ccc' : '#4CAF50' }}
              onPress={handlePurchase}
              disabled={isProcessingPayment || !isMobilePlatform}
            >
              {isProcessingPayment ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <ThemedText style={{ color: '#fff', fontWeight: 'bold', fontSize: 18 }}>
                  Subscribe via Google Play
                </ThemedText>
              )}
            </TouchableOpacity>

            {!isMobilePlatform && (
              <ThemedText style={{ color: '#D32F2F', textAlign: 'center', marginTop: 12, fontSize: 13 }}>
                💳 Billing is only available on physical mobile devices.
              </ThemedText>
            )}

            <TouchableOpacity style={{ marginTop: 25, alignItems: 'center' }} onPress={handleBackToForm}>
              <ThemedText style={{ color: '#666' }}>← Edit school details</ThemedText>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </ThemedView>
  );
}

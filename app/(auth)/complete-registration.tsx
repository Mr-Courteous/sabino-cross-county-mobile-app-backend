import { View, ActivityIndicator, ScrollView, Platform, FlatList, ImageBackground, StyleSheet, Text, TouchableOpacity, useWindowDimensions, Image, Linking } from 'react-native';

const logFbEvent = (event: string) => {
  if (Platform.OS === 'web') return;
  try {
    const { AppEventsLogger } = require('react-native-fbsdk-next');
    AppEventsLogger.logEvent(event);
  } catch (e) {
    // FB SDK not initialized — safe to ignore
  }
};

const logFbPurchase = (amount: number, currency: string) => {
  if (Platform.OS === 'web') return;
  try {
    const { AppEventsLogger } = require('react-native-fbsdk-next');
    // Use logEvent instead of logPurchase — more reliable across SDK versions
    AppEventsLogger.logEvent('fb_mobile_purchase', amount, {
      fb_currency: currency,
    });
  } catch (e) {
    console.warn('[FB] Purchase event failed:', e); // ← log it, don't swallow it
  }
};
import { useState, useEffect, useMemo, useCallback } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { API_BASE_URL } from '@/utils/api-service';
import { validatePassword } from '@/utils/password-validator';
import Purchases from 'react-native-purchases';
import * as SecureStore from 'expo-secure-store';
import { CustomButton } from '@/components/custom-button';
import { CustomInput } from '@/components/custom-input';
import { CustomAlert } from '@/components/custom-alert';
import { ThemedView } from '@/components/themed-view';
import { Colors } from '@/constants/design-system';
import { syncSubscriptionWithRetries } from '@/utils/subscription-sync';

const REVENUECAT_GOOGLE_API_KEY = 'goog_DoercEbvtNXRhqfTjOYMkzCJKlX';

export default function CompleteRegistrationScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const styles = useMemo(() => makeStyles(width), [width]);
  const params = useLocalSearchParams();
  const email = params.email as string;
  const isMobilePlatform = Platform.OS === 'android' || Platform.OS === 'ios';

  const [countries, setCountries] = useState<Array<{ id: number, code: string, name: string }>>([]);
  const [showCountryDropdown, setShowCountryDropdown] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [currentStep, setCurrentStep] = useState<'form' | 'payment'>('form');
  const [formData, setFormData] = useState({ password: '', confirmPassword: '', firstName: '', lastName: '', phone: '', schoolName: '', schoolType: 'private', country: '', countryId: null as number | null });
  const [rcPackage, setRcPackage] = useState<any>(null);
  const [loadingPackage, setLoadingPackage] = useState(isMobilePlatform);
  const [purchasing, setPurchasing] = useState(false);
  const [billingMessage, setBillingMessage] = useState('');
  const [confirmingMessage, setConfirmingMessage] = useState('');
  const [paymentStep, setPaymentStep] = useState<'info' | 'purchasing' | 'success'>('info');
  const [schoolId, setSchoolId] = useState<number | null>(null);

  // ── Web checkout fallback (Google-safe alternative payment) ──────────────────
  const [webPayLoading, setWebPayLoading] = useState(false);
  const [webPayTxRef, setWebPayTxRef] = useState('');
  const [webPayLinkOpened, setWebPayLinkOpened] = useState(false);
  const [webPayVerifying, setWebPayVerifying] = useState(false);
  const [webPayError, setWebPayError] = useState('');

  const fetchCountries = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/countries`);
      const data = await response.json();
      if (data.success) setCountries(data.data);
    } catch (err) { }
  };

  const getAuthToken = async () => {
    try {
      return Platform.OS === 'web'
        ? localStorage.getItem('userToken')
        : await SecureStore.getItemAsync('userToken');
    } catch (err) {
      return null;
    }
  };

  const getStoredUserId = async () => {
    try {
      const storedUser = Platform.OS === 'web'
        ? localStorage.getItem('userData')
        : await SecureStore.getItemAsync('userData');

      if (!storedUser) return undefined;
      const parsed = JSON.parse(storedUser);
      return parsed?.schoolId?.toString() || parsed?.id?.toString();
    } catch (err) {
      return undefined;
    }
  };

  const setAuthToken = async (token: string) => {
    try {
      if (Platform.OS === 'web') {
        localStorage.setItem('userToken', token);
      } else {
        await SecureStore.setItemAsync('userToken', token);
      }
    } catch (err) {
      console.error('Failed to store auth token:', err);
    }
  };

  const setUserData = async (data: any) => {
    try {
      if (Platform.OS === 'web') {
        localStorage.setItem('userData', JSON.stringify(data));
      } else {
        await SecureStore.setItemAsync('userData', JSON.stringify(data));
      }
    } catch (err) {
      console.error('Failed to store user data:', err);
    }
  };

  useEffect(() => {
    fetchCountries();
    if (isMobilePlatform) {
      Purchases.configure({ apiKey: REVENUECAT_GOOGLE_API_KEY });

      const loadOfferings = async () => {
        setLoadingPackage(true);
        try {
          const offerings = await Purchases.getOfferings();
          const current = offerings.current;
          const availablePackages = current?.availablePackages;
          if (availablePackages && availablePackages.length > 0) {
            setRcPackage(availablePackages[0]);
          } else {
            setBillingMessage('No active subscription plans are available in Google Play / App Store.');
          }
        } catch (err: any) {
          setBillingMessage(`Could not connect to store: ${err.message || err}`);
        } finally {
          setLoadingPackage(false);
        }
      };

      loadOfferings();
    } else {
      setLoadingPackage(false);
    }
  }, []);



  const handleCompleteRegistration = async () => {
    if (!formData.schoolName || !formData.password || !formData.firstName || !formData.countryId) {
      setError('Please fill all required fields, including selecting your country');
      return;
    }

    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    const passValidation = validatePassword(formData.password);
    if (!passValidation.isValid) {
      setError(passValidation.errorMessage);
      return;
    }

    setLoading(true);
    try {
      const payload = {
        name: formData.schoolName,
        email: email.toLowerCase(),
        password: formData.password,
        school_type: formData.schoolType,
        country_id: formData.countryId,
        country: formData.country,
        phone: formData.phone,
        payment_status: 'pending'
      };

      const response = await fetch(`${API_BASE_URL}/api/schools`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const res = await response.json();
      if (response.ok && res.data) {
        // Store token and user data for subsequent API calls
        if (res.data.token) {
          await setAuthToken(res.data.token);
        }
        if (res.data.id || res.data.user?.schoolId) {
          const sid = res.data.id || res.data.user?.schoolId;
          setSchoolId(sid);
          await setUserData({ id: sid, schoolId: sid, ...res.data.user, ...res.data });

          // Identity sync with RevenueCat for mobile
          if (isMobilePlatform) {
            try {
              await Purchases.logIn(sid.toString());
              console.log(`👤 [Registration] Identified RevenueCat user as: ${sid}`);

              // Re-fetch offerings under the correct identity
              const offerings = await Purchases.getOfferings();
              const pkg = offerings.current?.availablePackages?.[0];
              if (pkg) setRcPackage(pkg);
            } catch (rcErr) {
              console.warn('[Registration] RevenueCat logIn/offerings failed:', rcErr);
            }
          }
        }
        setPaymentStep('info');
        setCurrentStep('payment');

        // ✅ Fire Meta Completed Registration event
        logFbEvent('fb_mobile_complete_registration');
      } else throw new Error(res.error || 'Setup failed');
    } catch (err: any) { setError(err.message); }
    finally { setLoading(false); }
  };

  const syncSubscriptionWithBackend = async (): Promise<{ isActive: boolean } | null> => {
    try {
      const token = await getAuthToken(); // already stored from registration
      if (!token) return null;

      // RevenueCat's REST API can take a few seconds to catch up right
      // after a purchase — retry a few times instead of giving up on the
      // first check. See utils/subscription-sync.ts for the full story.
      return await syncSubscriptionWithRetries(token, (attempt, max) => {
        setConfirmingMessage(attempt === 1 ? 'Confirming your payment...' : `Confirming your payment (${attempt}/${max})...`);
      });
    } catch {
      return null;
    } finally {
      setConfirmingMessage('');
    }
  };

  const handleSubscriptionPurchase = async () => {
    if (!rcPackage) return;
    setBillingMessage('');
    setPurchasing(true);
    setPaymentStep('purchasing');

    try {
      try {
        const currentAppUserId = await Purchases.getAppUserID();
        console.log(`[RC] app_user_id right before purchase: ${currentAppUserId}`);
      } catch { /* logging only, never block the purchase on this */ }

      const { customerInfo } = await Purchases.purchasePackage(rcPackage);
      const clientSaysActive = Object.keys(customerInfo.entitlements.active).length > 0;

      if (clientSaysActive) {
        // Ask the backend to verify with RevenueCat REST API — this is the real gate
        const syncResult = await syncSubscriptionWithBackend();

        if (syncResult?.isActive) {
          // ✅ Backend confirmed via RevenueCat REST API — safe to log
          logFbPurchase(rcPackage.product.price, rcPackage.product.currencyCode);
          setPaymentStep('success');
          // Auto-redirect to dashboard after a short delay
          setTimeout(() => {
            router.replace('/dashboard' as any);
          }, 1500);
        } else {
          // Client said active but backend still couldn't confirm after
          // retrying. The charge almost certainly went through — this is
          // a sync delay, not a failed payment. Point them at "Restore
          // Purchases" (which re-runs the same confirmation) instead of
          // implying they need to pay again.
          setBillingMessage('Payment received! Confirmation is taking a little longer than usual — tap "Restore Purchases" below in a moment to finish activating.');
          setPaymentStep('info');
        }
      } else {
        throw new Error('Payment completed but access not yet activated. Try restoring.');
      }
    } catch (err: any) {
      if (err?.userCancelled) {
        setPaymentStep('info');
        setPurchasing(false);
        return;
      }
      setBillingMessage(err.message || 'Payment failed.');
      setPaymentStep('info');
    } finally {
      setPurchasing(false);
    }
  };

  const handleRestorePurchase = async () => {
    if (!isMobilePlatform) return; // just do nothing on web, no bypass

    setBillingMessage('');
    setPurchasing(true);

    try {
      const customerInfo = await Purchases.restorePurchases();
      const isActive = Object.keys(customerInfo.entitlements.active).length > 0;

      if (isActive) {
        const syncResult = await syncSubscriptionWithBackend(); // ← same retrying sync
        if (syncResult?.isActive) {
          setPaymentStep('success');
          setTimeout(() => {
            router.replace('/dashboard' as any);
          }, 1500);
        } else {
          setBillingMessage('Your purchase was found but is still being confirmed on our end. Please try again in a minute.');
        }
      } else {
        setBillingMessage('No active subscriptions found.');
      }
    } catch (err: any) {
      setBillingMessage(err.message || 'Restore failed.');
    } finally {
      setPurchasing(false);
    }
  };

  // ── Step 1: Call backend to get a Flutterwave payment link, open in browser ──
  // This is Google-safe: it's a web checkout, not bypassing Play Billing.
  // We still offer Google Play as the primary option above.
  const handleWebCheckout = async () => {
    setWebPayError('');
    setWebPayLinkOpened(false);
    setWebPayTxRef('');
    setWebPayLoading(true);
    try {
      const token = await getAuthToken();
      const res = await fetch(`${API_BASE_URL}/api/payments/initiate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        // plan_id 1 = your default subscription plan — adjust to match your backend
        body: JSON.stringify({ plan_id: 1 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Could not generate payment link.');
      if (!data.link) throw new Error('Server did not return a payment link.');

      // Save the tx_ref so we can verify after the user returns from the browser
      if (data.tx_ref) setWebPayTxRef(data.tx_ref);

      // Open Flutterwave checkout in the device's default browser
      await Linking.openURL(data.link);

      // Show the "I've paid" verify button once the link is opened
      setWebPayLinkOpened(true);
    } catch (err: any) {
      setWebPayError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setWebPayLoading(false);
    }
  };

  // ── Step 2: User returns from browser → verify the payment with your backend ─
  const handleWebCheckoutVerify = async () => {
    if (!webPayTxRef) {
      setWebPayError('Transaction reference missing. Please contact support.');
      return;
    }
    setWebPayError('');
    setWebPayVerifying(true);
    try {
      const token = await getAuthToken();
      const res = await fetch(`${API_BASE_URL}/api/payments/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ tx_ref: webPayTxRef }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Verification failed. Please wait a moment and try again.');

      // ✅ Fire Meta Purchase event (Flutterwave path)
      logFbPurchase(29500, 'NGN'); // use your actual plan amount

      // ✅ Payment confirmed — same success flow as Google Play
      setPaymentStep('success');
      setTimeout(() => {
        router.replace('/dashboard' as any);
      }, 1500);
    } catch (err: any) {
      setWebPayError(err.message || 'Could not verify payment. Please try again.');
    } finally {
      setWebPayVerifying(false);
    }
  };

  const isTiny = width < 300;

  return (
    <ThemedView style={{ flex: 1, backgroundColor: Colors.accent.navy }}>
      <ImageBackground source={{ uri: 'https://images.unsplash.com/photo-1546410531-bb4caa6b424d?q=80&w=2071' }} style={styles.hero}>
        <LinearGradient colors={['rgba(10, 15, 30, 0.8)', 'rgba(15, 23, 42, 0.98)']} style={styles.overlay}>
          <ScrollView contentContainerStyle={styles.scrollContainer} showsVerticalScrollIndicator={false}>
            <View style={styles.header}>
              <TouchableOpacity
                style={styles.backBtn}
                onPress={() => router.back()}
              >
                <Ionicons name="arrow-back" size={20} color="#fff" />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.homeBtn}
                onPress={() => {
                  router.replace('/home');
                }}
                activeOpacity={0.7}
              >
                <Ionicons name="home-outline" size={18} color="#fff" />
              </TouchableOpacity>
              <View style={styles.logoBadge}>
                <Image source={require('../../assets/images/sabino.jpeg')} style={{ width: 40, height: 40, borderRadius: 20 }} />
                <Text style={styles.logoText}>SABINO EDU</Text>
              </View>
              <Text style={styles.title}>{currentStep === 'form' ? 'Details' : 'Activation'}</Text>
              <View style={styles.goldBar} />
            </View>

            <View style={styles.card}>
              {error ? <CustomAlert type="error" title="Error" message={error} onClose={() => setError('')} style={{ marginBottom: 16 }} /> : null}
              {currentStep === 'form' ? (
                <>
                  <TouchableOpacity style={styles.dropdown} onPress={() => setShowCountryDropdown(!showCountryDropdown)}>
                    <Text style={[styles.dropdownText, !formData.country && { color: '#64748B' }]}>{formData.country || 'Select Country'}</Text>
                    <Ionicons name="chevron-down" size={18} color="#FACC15" />
                  </TouchableOpacity>
                  {showCountryDropdown && (
                    <ScrollView style={styles.dropdownList} contentContainerStyle={styles.dropdownListContent} nestedScrollEnabled>
                      {countries.map(c => (
                        <TouchableOpacity key={c.id} style={styles.dropdownItem} onPress={() => { setFormData({ ...formData, country: c.name, countryId: c.id }); setShowCountryDropdown(false); }}>
                          <Text style={styles.dropdownItemText}>{c.name}</Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  )}
                  <CustomInput label="School Name" placeholder="School Name" value={formData.schoolName} onChangeText={(t) => setFormData({ ...formData, schoolName: t })} />
                  <View style={styles.row}>
                    <View style={{ flex: 1, marginRight: 6 }}><CustomInput label="First Name" placeholder="First Name" value={formData.firstName} onChangeText={(t) => setFormData({ ...formData, firstName: t })} /></View>
                    <View style={{ flex: 1, marginLeft: 6 }}><CustomInput label="Last Name" placeholder="Last Name" value={formData.lastName} onChangeText={(t) => setFormData({ ...formData, lastName: t })} /></View>
                  </View>
                  <CustomInput label="Password" placeholder="••••••••" isPassword value={formData.password} onChangeText={(t) => setFormData({ ...formData, password: t })} />
                  <CustomInput label="Confirm Password" placeholder="••••••••" isPassword value={formData.confirmPassword} onChangeText={(t) => setFormData({ ...formData, confirmPassword: t })} />

                  <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: -4, marginBottom: 12 }}>
                    <Ionicons name="information-circle-outline" size={12} color="#94A3B8" />
                    <Text style={{ color: '#94A3B8', fontSize: 9, marginLeft: 6, fontWeight: '700' }}>
                      USE STRONG PASSWORD: 8+ CHARS (A-Z, a-z, 0-9, !@#$)
                    </Text>
                  </View>
                  <CustomButton title={loading ? "SAVING..." : "ACTIVATE"} onPress={handleCompleteRegistration} loading={loading} variant="premium" style={styles.ctaButton} />
                </>
              ) : (
                <>
                  {paymentStep === 'info' && (
                    <View style={{ alignItems: 'center' }}>
                      <Ionicons name="shield-checkmark" size={48} color="#FACC15" />
                      <Text style={styles.successTitle}>Complete Your Subscription</Text>
                      <Text style={styles.subtitle}>
                        Your school account is created. Complete your subscription to start using Sabino Edu.
                      </Text>

                      {isMobilePlatform ? (
                        <>
                          {loadingPackage ? (
                            <ActivityIndicator color="#FACC15" style={{ marginVertical: 16 }} />
                          ) : rcPackage ? (
                            <>
                              <View style={styles.priceTag}>
                                <Text style={styles.priceLabel}>Premium School Plan</Text>
                                <Text style={styles.priceValue}>{rcPackage.product.priceString}</Text>
                                <Text style={styles.pricePeriod}>Billed Every Four Months</Text>
                              </View>

                              <CustomButton
                                title={purchasing ? 'PROCESSING...' : 'COMPLETE SUBSCRIPTION'}
                                onPress={handleSubscriptionPurchase}
                                loading={purchasing}
                                variant="premium"
                                style={styles.ctaButton}
                              />
                            </>
                          ) : (
                            <Text style={[styles.subtitle, { marginTop: 16, color: '#FACC15' }]}>{billingMessage || 'Unable to load subscription details right now.'}</Text>
                          )}
                        </>
                      ) : (
                        <Text style={[styles.subtitle, { marginTop: 16 }]}>Billing is only available on Android/iOS devices. Please open the app on a mobile device to complete your subscription.</Text>
                      )}

                      {billingMessage ? <Text style={{ color: '#F87171', marginTop: 12, textAlign: 'center' }}>{billingMessage}</Text> : null}

                      <TouchableOpacity
                        style={{ marginTop: 20 }}
                        onPress={handleRestorePurchase}
                        disabled={purchasing}
                      >
                        <Text style={{ color: '#64748B', fontSize: 13, fontWeight: '700', textDecorationLine: 'underline' }}>Restore Purchases</Text>
                      </TouchableOpacity>

                      {/* ── School & Corporate Billing Portal ────────────────────────────── */}
                      <View style={styles.webPayDivider}>
                        <View style={styles.webPayDividerLine} />
                        <Text style={styles.webPayDividerText}>SCHOOL & CORPORATE BILLING</Text>
                        <View style={styles.webPayDividerLine} />
                      </View>

                      <Text style={styles.webPayHint}>
                        Government schools, NGOs, and institutions requiring invoice-based payment,
                        bank transfer, or mobile money can use our dedicated school billing portal.                      </Text>

                      {/* Step 1: Open payment link in browser */}
                      {!webPayLinkOpened && (
                        <TouchableOpacity
                          style={[styles.webPayButton, webPayLoading && { opacity: 0.6 }]}
                          onPress={handleWebCheckout}
                          disabled={webPayLoading || purchasing}
                          activeOpacity={0.8}
                        >
                          {webPayLoading ? (
                            <ActivityIndicator color="#0F172A" size="small" />
                          ) : (
                            <>
                              <Ionicons name="globe-outline" size={14} color="#0F172A" style={{ marginRight: 6 }} />
                              <Text style={styles.webPayButtonText}>ACTIVATE VIA SCHOOL BILLING PORTAL</Text>
                            </>
                          )}
                        </TouchableOpacity>
                      )}

                      {/* Step 2: After browser opens, user returns and confirms */}
                      {webPayLinkOpened && (
                        <View style={{ width: '100%', alignItems: 'center' }}>
                          <Text style={styles.webPayReturnHint}>
                            Once your institution has completed payment through the billing portal, tap below to activate your account.
                          </Text>
                          <TouchableOpacity
                            style={[styles.webPayVerifyButton, webPayVerifying && { opacity: 0.6 }]}
                            onPress={handleWebCheckoutVerify}
                            disabled={webPayVerifying}
                            activeOpacity={0.8}
                          >
                            {webPayVerifying ? (
                              <ActivityIndicator color="#fff" size="small" />
                            ) : (
                              <>
                                <Ionicons name="checkmark-circle-outline" size={14} color="#fff" style={{ marginRight: 6 }} />
                                <Text style={styles.webPayVerifyText}>CONFIRM INSTITUTIONAL PAYMENT</Text>
                              </>
                            )}
                          </TouchableOpacity>
                          {/* Allow re-opening the link if user accidentally closed it */}
                          <TouchableOpacity
                            style={{ marginTop: 10 }}
                            onPress={handleWebCheckout}
                            disabled={webPayLoading}
                          >
                            <Text style={{ color: '#64748B', fontSize: 11, fontWeight: '700', textDecorationLine: 'underline' }}>
                              Re-open payment page
                            </Text>
                          </TouchableOpacity>
                        </View>
                      )}

                      {/* Error feedback for web checkout */}
                      {webPayError ? (
                        <Text style={{ color: '#F87171', fontSize: 12, marginTop: 10, textAlign: 'center', fontWeight: '600' }}>
                          {webPayError}
                        </Text>
                      ) : null}
                    </View>
                  )}

                  {paymentStep === 'purchasing' && (
                    <View style={styles.centered}>
                      <ActivityIndicator size="large" color="#FACC15" />
                      <Text style={styles.loadingTitle}>Connecting to Store...</Text>
                      <Text style={styles.loadingSubtitle}>
                        {confirmingMessage || 'Please complete the payment in the system dialog.'}
                      </Text>
                    </View>
                  )}

                  {paymentStep === 'success' && (
                    <View style={styles.centered}>
                      <Ionicons name="checkmark-circle" size={80} color="#10B981" />
                      <Text style={[styles.successTitle, { color: '#10B981', marginTop: 20 }]}>Payment Successful!</Text>
                      <Text style={styles.successSubtitle}>Your school account is now fully active.</Text>
                      <CustomButton
                        title="OPEN DASHBOARD"
                        onPress={() => router.replace('/dashboard' as any)}
                        variant="premium"
                        style={styles.ctaButton}
                      />
                    </View>
                  )}
                </>
              )}
            </View>
            <View style={styles.footer}><Text style={styles.footerText}>SECURE REGISTRATION</Text></View>
          </ScrollView>
        </LinearGradient>
      </ImageBackground>
    </ThemedView>
  );
}

function makeStyles(width: number) {
  const isTiny = width < 300;
  return StyleSheet.create({
    hero: { flex: 1, width: '100%' },
    overlay: { flex: 1, paddingHorizontal: isTiny ? 16 : 24 },
    scrollContainer: { flexGrow: 1, justifyContent: 'center', paddingVertical: isTiny ? 30 : 50 },
    header: { alignItems: 'center', marginBottom: isTiny ? 20 : 30 },
    backBtn: {
      position: 'absolute',
      top: 0,
      left: 0,
      width: 36,
      height: 36,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: 'rgba(255,255,255,0.1)',
      borderRadius: 18,
      zIndex: 10
    },
    homeBtn: {
      position: 'absolute',
      top: 0,
      right: 0,
      width: 36,
      height: 36,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: 'rgba(255,255,255,0.1)',
      borderRadius: 18,
      zIndex: 10
    },
    logoBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.08)', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, marginBottom: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
    logoText: { color: '#FACC15', fontSize: 11, fontWeight: '900', marginLeft: 8, letterSpacing: 2 },
    title: { fontSize: isTiny ? 26 : 30, fontWeight: '900', color: '#fff', letterSpacing: -1 },
    goldBar: { width: 40, height: 3, backgroundColor: '#FACC15', borderRadius: 2, marginVertical: 12 },
    subtitle: { fontSize: 12, color: '#94A3B8', fontWeight: '500', textAlign: 'center', marginTop: 10 },
    card: { backgroundColor: 'rgba(30, 41, 59, 0.7)', borderRadius: 28, padding: isTiny ? 20 : 26, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
    row: { flexDirection: 'row' },
    dropdown: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'rgba(15, 23, 42, 0.5)', padding: 14, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', marginBottom: 10 },
    dropdownText: { color: '#F8FAFC', fontSize: 13, fontWeight: '500' },
    dropdownList: { backgroundColor: '#1E293B', borderRadius: 12, marginTop: -5, marginBottom: 12, maxHeight: 220 },
    dropdownListContent: { paddingVertical: 4 },
    dropdownItem: { padding: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' },
    dropdownItemText: { color: '#F8FAFC', fontSize: 13 },
    ctaButton: { height: 52, borderRadius: 12, marginTop: 16, width: '100%' },
    successTitle: { color: '#fff', fontSize: 18, fontWeight: '900', marginTop: 16 },
    priceTag: {
      backgroundColor: 'rgba(250,204,21,0.08)',
      borderRadius: 16,
      borderWidth: 1,
      borderColor: 'rgba(250,204,21,0.2)',
      padding: 20,
      alignItems: 'center',
      marginTop: 18,
      marginBottom: 10,
      width: '100%'
    },
    priceLabel: { color: '#94A3B8', fontSize: 12, fontWeight: '700', marginBottom: 4 },
    priceValue: { color: '#fff', fontSize: 32, fontWeight: '900' },
    pricePeriod: { color: '#64748B', fontSize: 12, marginTop: 4 },
    centered: { alignItems: 'center', paddingVertical: 30 },
    loadingTitle: { color: '#fff', fontSize: 18, fontWeight: '900', marginTop: 20 },
    loadingSubtitle: { color: '#94A3B8', fontSize: 14, marginTop: 8, textAlign: 'center' },
    successSubtitle: { color: '#94A3B8', fontSize: 14, marginTop: 8, marginBottom: 20, textAlign: 'center' },
    footer: { marginTop: 30, alignItems: 'center' },
    footerText: { color: '#334155', fontSize: 9, fontWeight: '800', letterSpacing: 1 },

    // ── Web checkout fallback styles ───────────────────────────────────────────
    webPayDivider: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: 28,
      marginBottom: 12,
      width: '100%',
    },
    webPayDividerLine: {
      flex: 1,
      height: 1,
      backgroundColor: 'rgba(255,255,255,0.08)',
    },
    webPayDividerText: {
      color: '#475569',
      fontSize: 9,
      fontWeight: '800',
      letterSpacing: 1.5,
      marginHorizontal: 10,
    },
    webPayHint: {
      color: '#64748B',
      fontSize: 11,
      fontWeight: '500',
      textAlign: 'center',
      marginBottom: 14,
      lineHeight: 16,
    },
    webPayButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: '#FACC15',
      borderRadius: 10,
      paddingVertical: 13,
      paddingHorizontal: 20,
      width: '100%',
    },
    webPayButtonText: {
      color: '#0F172A',
      fontSize: 11,
      fontWeight: '900',
      letterSpacing: 1,
    },
    webPayReturnHint: {
      color: '#94A3B8',
      fontSize: 11,
      textAlign: 'center',
      marginBottom: 12,
      lineHeight: 16,
      fontWeight: '500',
    },
    webPayVerifyButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: '#10B981',
      borderRadius: 10,
      paddingVertical: 13,
      paddingHorizontal: 20,
      width: '100%',
    },
    webPayVerifyText: {
      color: '#fff',
      fontSize: 11,
      fontWeight: '900',
      letterSpacing: 1,
    },
  });
}
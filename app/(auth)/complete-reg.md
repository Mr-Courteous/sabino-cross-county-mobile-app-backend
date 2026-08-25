import { View, TextInput, TouchableOpacity, Text, ActivityIndicator, ScrollView, Alert, Platform, FlatList } from 'react-native';
import { useState, useEffect } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { API_BASE_URL } from '@/utils/api-service';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { validatePassword } from '@/utils/password-validator';

export default function CompleteRegistrationScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();

  const email = params.email as string;

  const [countries, setCountries] = useState<Array<{ id: number, code: string, name: string, description: string }>>([]);
  const [showCountryDropdown, setShowCountryDropdown] = useState(false);
  const [loadingCountries, setLoadingCountries] = useState(true);
  const [countriesError, setCountriesError] = useState('');

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

  // Fetch countries on component mount
  useEffect(() => {
    fetchCountries();
  }, []);

  const fetchCountries = async () => {
    try {
      setLoadingCountries(true);
      setCountriesError('');

      const response = await fetch(`${API_BASE_URL}/api/auth/countries`);
      const data = await response.json();

      if (data.success && Array.isArray(data.data)) {
        setCountries(data.data);
      } else {
        setCountriesError('Failed to load countries');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch countries';
      setCountriesError(errorMessage);
      console.error('Countries fetch error:', err);
    } finally {
      setLoadingCountries(false);
    }
  };

  const validateForm = () => {
    if (!formData.country.trim()) {
      setError('Please select a country');
      return false;
    }

    if (!formData.schoolName.trim()) {
      setError('School name is required');
      return false;
    }

    if (!formData.password.trim()) {
      setError('Password is required');
      return false;
    }

    // Validate password strength
    const passwordValidation = validatePassword(formData.password);
    if (!passwordValidation.isValid) {
      setError(passwordValidation.errorMessage);
      return false;
    }

    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match');
      return false;
    }

    if (!formData.firstName.trim()) {
      setError('First name is required');
      return false;
    }

    if (!formData.lastName.trim()) {
      setError('Last name is required');
      return false;
    }

    if (formData.phone && !/^\d{10,}$/.test(formData.phone.replace(/\D/g, ''))) {
      setError('Phone number must be at least 10 digits');
      return false;
    }

    return true;
  };

  const handleCompleteRegistration = async () => {
    if (!validateForm()) {
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await fetch(`${API_BASE_URL}/api/schools`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password: formData.password,
          firstName: formData.firstName,
          lastName: formData.lastName,
          phone: formData.phone || undefined,
          name: formData.schoolName,
          school_type: formData.schoolType,
          country: formData.country,
        }),
      });

      const data = await response.json();

      if (response.ok && data.success && data.data?.token) {
        const token = data.data.token;
        const user = {
          schoolId: data.data.user?.schoolId,
          email: data.data.user?.email,
          name: data.data.user?.name,
          type: 'school',
          countryId: data.data.user?.countryId,
          country: formData.country,
        };

        // Store token securely
        if (Platform.OS !== 'web') {
          try {
            await SecureStore.setItemAsync('userToken', token);
            await SecureStore.setItemAsync('userData', JSON.stringify(user));
            await SecureStore.setItemAsync('countryId', String(user.countryId || ''));
          } catch (e) {
            localStorage.setItem('userToken', token);
            localStorage.setItem('userData', JSON.stringify(user));
            localStorage.setItem('countryId', String(user.countryId || ''));
          }
        } else {
          localStorage.setItem('userToken', token);
          localStorage.setItem('userData', JSON.stringify(user));
          localStorage.setItem('countryId', String(user.countryId || ''));
        }

        router.replace('/dashboard');
      } else {
        // Display actual backend error
        const errorMsg = data.error || data.message || 'Registration failed';
        setError(errorMsg);
      }
    } catch (err) {
      console.error('Registration Error:', err);
      const errorMessage = err instanceof Error ? err.message : 'An unexpected error occurred';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ThemedView style={{ flex: 1 }}>
      <ScrollView
        style={{ flex: 1, padding: 20 }}
        contentContainerStyle={{ paddingBottom: 40 }}
      >
        <View style={{ marginBottom: 30 }}>
          <ThemedText type="title" style={{ marginBottom: 10 }}>
            Complete Registration
          </ThemedText>
          <ThemedText type="subtitle" style={{ opacity: 0.7 }}>
            Step 3: School & Admin Details
          </ThemedText>
        </View>

        {countriesError && (
          <View
            style={{
              backgroundColor: '#ffebee',
              borderLeftColor: '#d32f2f',
              borderLeftWidth: 5,
              padding: 14,
              borderRadius: 6,
              marginBottom: 20,
              borderWidth: 1,
              borderColor: '#ffcdd2',
            }}
          >
            <ThemedText style={{ color: '#c62828', fontSize: 15, fontWeight: '600', marginBottom: 4 }}>
              ⚠️ Countries Load Error
            </ThemedText>
            <ThemedText style={{ color: '#b71c1c', fontSize: 14, lineHeight: 20 }}>
              {countriesError}
            </ThemedText>
            <TouchableOpacity
              style={{ marginTop: 8 }}
              onPress={fetchCountries}
            >
              <ThemedText style={{ color: '#d32f2f', fontSize: 14, fontWeight: '600' }}>
                🔄 Retry
              </ThemedText>
            </TouchableOpacity>
          </View>
        )}

        {loadingCountries && (
          <View
            style={{
              backgroundColor: '#e3f2fd',
              padding: 16,
              borderRadius: 8,
              marginBottom: 20,
              alignItems: 'center',
              flexDirection: 'row',
              justifyContent: 'center',
            }}
          >
            <ActivityIndicator color="#1976d2" size="small" style={{ marginRight: 8 }} />
            <ThemedText style={{ fontSize: 14, color: '#1976d2', fontWeight: '500' }}>
              Loading countries...
            </ThemedText>
          </View>
        )}

        {!loadingCountries && countries.length > 0 && (
          <View style={{ marginBottom: 16 }}>
            <ThemedText style={{ marginBottom: 6, fontWeight: '600', fontSize: 14 }}>
              Select Country *
            </ThemedText>
            <TouchableOpacity
              style={{
                borderWidth: 1,
                borderColor: '#ddd',
                borderRadius: 6,
                padding: 12,
                backgroundColor: '#fff',
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
              onPress={() => setShowCountryDropdown(!showCountryDropdown)}
              disabled={loading}
            >
              <ThemedText
                style={{
                  fontSize: 14,
                  color: formData.country ? '#000' : '#999',
                }}
              >
                {formData.country || 'Choose a country...'}
              </ThemedText>
              <ThemedText style={{ fontSize: 16 }}>
                {showCountryDropdown ? '▲' : '▼'}
              </ThemedText>
            </TouchableOpacity>

            {showCountryDropdown && (
              <View
                style={{
                  borderWidth: 1,
                  borderColor: '#ddd',
                  borderTopWidth: 0,
                  borderRadius: 0,
                  borderBottomLeftRadius: 6,
                  borderBottomRightRadius: 6,
                  backgroundColor: '#fff',
                  maxHeight: 200,
                  marginTop: -1,
                }}
              >
                <FlatList
                  data={countries}
                  keyExtractor={(item) => String(item.id)}
                  scrollEnabled={true}
                  nestedScrollEnabled={true}
                  renderItem={({ item }) => (
                    <TouchableOpacity
                      style={{
                        padding: 12,
                        borderBottomWidth: 1,
                        borderBottomColor: '#eee',
                        backgroundColor: formData.country === item.name ? '#e8f5e9' : '#fff',
                      }}
                      onPress={() => {
                        setFormData({
                          ...formData,
                          country: item.name,
                          countryId: item.id,
                        });
                        setShowCountryDropdown(false);
                        setError('');
                      }}
                    >
                      <ThemedText
                        style={{
                          fontSize: 14,
                          color: formData.country === item.name ? '#2e7d32' : '#333',
                          fontWeight: formData.country === item.name ? '600' : '400',
                        }}
                      >
                        {item.name}
                      </ThemedText>
                      {item.code && (
                        <ThemedText style={{ fontSize: 12, color: '#666', marginTop: 2 }}>
                          {item.code}
                        </ThemedText>
                      )}
                    </TouchableOpacity>
                  )}
                />
              </View>
            )}
          </View>
        )}

        <View style={{ marginBottom: 16 }}>
          <ThemedText style={{ marginBottom: 6, fontWeight: '600', fontSize: 14 }}>
            School Name *
          </ThemedText>
          <TextInput
            style={{
              borderWidth: 1,
              borderColor: '#ddd',
              borderRadius: 6,
              padding: 10,
              fontSize: 14,
              backgroundColor: '#fff',
            }}
            placeholder="Your School Name"
            placeholderTextColor="#999"
            value={formData.schoolName}
            onChangeText={(text) => {
              setFormData({ ...formData, schoolName: text });
              setError('');
            }}
            editable={!loading}
          />
        </View>

        <View style={{ marginBottom: 16 }}>
          <ThemedText style={{ marginBottom: 8, fontWeight: '600', fontSize: 14 }}>
            School Type *
          </ThemedText>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            {['private', 'public'].map((type) => (
              <TouchableOpacity
                key={type}
                style={{
                  flex: 1,
                  paddingVertical: 10,
                  borderRadius: 6,
                  borderWidth: 2,
                  borderColor: formData.schoolType === type ? '#4CAF50' : '#ddd',
                  backgroundColor: formData.schoolType === type ? '#e8f5e9' : '#fff',
                  alignItems: 'center',
                }}
                onPress={() => {
                  setFormData({ ...formData, schoolType: type });
                  setError('');
                }}
              >
                <ThemedText
                  style={{
                    textTransform: 'capitalize',
                    fontWeight: '600',
                    color: formData.schoolType === type ? '#4CAF50' : '#666',
                  }}
                >
                  {type}
                </ThemedText>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={{ marginBottom: 16 }}>
          <ThemedText style={{ marginBottom: 6, fontWeight: '600', fontSize: 14 }}>
            First Name *
          </ThemedText>
          <TextInput
            style={{
              borderWidth: 1,
              borderColor: '#ddd',
              borderRadius: 6,
              padding: 10,
              fontSize: 14,
              backgroundColor: '#fff',
            }}
            placeholder="John"
            placeholderTextColor="#999"
            value={formData.firstName}
            onChangeText={(text) => {
              setFormData({ ...formData, firstName: text });
              setError('');
            }}
            editable={!loading}
          />
        </View>

        <View style={{ marginBottom: 16 }}>
          <ThemedText style={{ marginBottom: 6, fontWeight: '600', fontSize: 14 }}>
            Last Name *
          </ThemedText>
          <TextInput
            style={{
              borderWidth: 1,
              borderColor: '#ddd',
              borderRadius: 6,
              padding: 10,
              fontSize: 14,
              backgroundColor: '#fff',
            }}
            placeholder="Doe"
            placeholderTextColor="#999"
            value={formData.lastName}
            onChangeText={(text) => {
              setFormData({ ...formData, lastName: text });
              setError('');
            }}
            editable={!loading}
          />
        </View>

        <View style={{ marginBottom: 16 }}>
          <ThemedText style={{ marginBottom: 6, fontWeight: '600', fontSize: 14 }}>
            Phone Number (Optional)
          </ThemedText>
          <TextInput
            style={{
              borderWidth: 1,
              borderColor: '#ddd',
              borderRadius: 6,
              padding: 10,
              fontSize: 14,
              backgroundColor: '#fff',
            }}
            placeholder="+234 800 000 0000"
            placeholderTextColor="#999"
            value={formData.phone}
            onChangeText={(text) => {
              setFormData({ ...formData, phone: text });
              setError('');
            }}
            editable={!loading}
            keyboardType="phone-pad"
          />
        </View>

        <View style={{ marginBottom: 16 }}>
          <ThemedText style={{ marginBottom: 6, fontWeight: '600', fontSize: 14 }}>
            Password *
          </ThemedText>
          <View style={{ position: 'relative' }}>
            <TextInput
              style={{
                borderWidth: 1,
                borderColor: '#ddd',
                borderRadius: 6,
                padding: 10,
                paddingRight: 45,
                fontSize: 14,
                backgroundColor: '#fff',
              }}
              placeholder="Must include: A-Z, a-z, 0-9, symbol"
              placeholderTextColor="#999"
              value={formData.password}
              onChangeText={(text) => {
                setFormData({ ...formData, password: text });
                setError('');
              }}
              editable={!loading}
              secureTextEntry={!showPassword}
            />
            <TouchableOpacity
              style={{
                position: 'absolute',
                right: 10,
                top: 10,
                padding: 5,
              }}
              onPress={() => setShowPassword(!showPassword)}
            >
              <Text style={{ fontSize: 18 }}>{showPassword ? '👁️' : '👁️‍🗨️'}</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={{ marginBottom: 16 }}>
          <ThemedText style={{ marginBottom: 6, fontWeight: '600', fontSize: 14 }}>
            Confirm Password *
          </ThemedText>
          <View style={{ position: 'relative' }}>
            <TextInput
              style={{
                borderWidth: 1,
                borderColor: '#ddd',
                borderRadius: 6,
                padding: 10,
                paddingRight: 45,
                fontSize: 14,
                backgroundColor: '#fff',
              }}
              placeholder="Re-enter password"
              placeholderTextColor="#999"
              value={formData.confirmPassword}
              onChangeText={(text) => {
                setFormData({ ...formData, confirmPassword: text });
                setError('');
              }}
              editable={!loading}
              secureTextEntry={!showConfirmPassword}
            />
            <TouchableOpacity
              style={{
                position: 'absolute',
                right: 10,
                top: 10,
                padding: 5,
              }}
              onPress={() => setShowConfirmPassword(!showConfirmPassword)}
            >
              <Text style={{ fontSize: 18 }}>{showConfirmPassword ? '👁️' : '👁️‍🗨️'}</Text>
            </TouchableOpacity>
          </View>
        </View>

        {error ? (
          <View
            style={{
              backgroundColor: '#ffebee',
              borderLeftColor: '#d32f2f',
              borderLeftWidth: 5,
              padding: 14,
              borderRadius: 6,
              marginBottom: 20,
              borderWidth: 1,
              borderColor: '#ffcdd2',
            }}
          >
            <ThemedText style={{ color: '#c62828', fontSize: 15, fontWeight: '600', marginBottom: 4 }}>
              ❌ Registration Error
            </ThemedText>
            <ThemedText style={{ color: '#b71c1c', fontSize: 14, lineHeight: 20 }}>
              {error}
            </ThemedText>
          </View>
        ) : null}

        <TouchableOpacity
          style={{
            backgroundColor: loading ? '#ccc' : '#4CAF50',
            padding: 16,
            borderRadius: 8,
            alignItems: 'center',
            opacity: loading ? 0.6 : 1,
          }}
          onPress={handleCompleteRegistration}
          disabled={loading}
        >
          {loading ? (
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <ActivityIndicator color="#fff" size="small" style={{ marginRight: 8 }} />
              <ThemedText style={{ color: '#fff', fontSize: 16, fontWeight: '600' }}>
                Completing Registration...
              </ThemedText>
            </View>
          ) : (
            <ThemedText style={{ color: '#fff', fontSize: 16, fontWeight: '600' }}>
              Complete Registration
            </ThemedText>
          )}
        </TouchableOpacity>

        <View
          style={{
            backgroundColor: '#e3f2fd',
            padding: 12,
            borderRadius: 8,
            marginTop: 20,
          }}
        >
          <ThemedText style={{ fontSize: 12, color: '#1976d2', lineHeight: 18 }}>
            ℹ️ After registration, you'll be logged in automatically and can manage students and scores.
          </ThemedText>
        </View>
      </ScrollView>
    </ThemedView>
  );
}

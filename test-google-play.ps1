# Google Play Billing Integration Test
# This script tests the payment verification endpoint

# Test the signup with pending payment
echo "Testing signup with pending payment..."
curl -X POST http://localhost:3000/api/schools \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test School",
    "email": "test@example.com",
    "password": "TestPass123!",
    "school_type": "primary",
    "country_id": 1
  }'

echo -e "\n\nTesting payment verification (this will fail without real Google Play token)..."
# This would need a real purchase token from Google Play
curl -X PATCH http://localhost:3000/api/schools/1/payment-status \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN_HERE" \
  -d '{
    "purchaseToken": "test_token"
  }'

echo -e "\n\nTesting subscription middleware on protected route..."
curl -X GET http://localhost:3000/api/students/me/enrollments \
  -H "Authorization: Bearer YOUR_JWT_TOKEN_HERE"
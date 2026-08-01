# Workflow: Generate Tests

## Rule
Every unit test case listed in `knowledge/domains/*.md` must exist as an `it(...)` block.
This is the acceptance criteria — not advisory.

## Test structure for service unit tests
```typescript
// __tests__/review.service.test.ts
import { ReviewService } from '../review.service';
import { MockReviewRepository } from './__mocks__/review.repository.mock';
import { MockGeminiService } from './__mocks__/gemini.service.mock';

describe('ReviewService', () => {
  let service: ReviewService;
  let mockRepo: MockReviewRepository;
  let mockGemini: MockGeminiService;

  beforeEach(() => {
    mockRepo = new MockReviewRepository();
    mockGemini = new MockGeminiService();
    service = new ReviewService(mockRepo, mockGemini);
  });

  describe('listReviews', () => {
    it('returns only reviews for the current user\'s installations', async () => {
      // Arrange
      mockRepo.findMany.mockResolvedValue([...]);
      // Act
      const result = await service.listReviews(userId, { page: 1, limit: 20 });
      // Assert
      expect(mockRepo.findMany).toHaveBeenCalledWith(expect.objectContaining({ installationIds }));
      expect(result.data.reviews).toHaveLength(...);
    });
  });
});
```

## Test structure for route integration tests
```typescript
// __tests__/review.routes.test.ts
import request from 'supertest';
import { app } from '../../app';
import { createTestUser, createTestInstallation } from '../helpers';

describe('GET /api/reviews', () => {
  it('returns 401 when no auth token', async () => {
    const res = await request(app).get('/api/reviews');
    expect(res.status).toBe(401);
  });

  it('returns 200 with reviews for authenticated user', async () => {
    const { token } = await createTestUser();
    const res = await request(app).get('/api/reviews').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
```

## How to generate tests from a domain file
1. Open `knowledge/domains/<domain>.md`
2. For each API route, find the **Unit test cases** block
3. Each `it(...)` line in that block becomes exactly one test in the `__tests__/` file
4. Edge cases table → each row is a test case
5. Run tests, fix failures, do not delete tests to make them pass

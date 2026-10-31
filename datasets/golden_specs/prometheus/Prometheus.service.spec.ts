import { Test, TestingModule } from '@nestjs/testing';
import { PrometheusService } from './Prometheus.service';

describe('PrometheusService', () => {
  let service: PrometheusService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PrometheusService],
    }).compile();

    service = module.get<PrometheusService>(PrometheusService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('recordMetrics', () => {
    it('should execute recordMetrics successfully and register http request count and duration', async () => {
      // Given (Arrange)
      const method = 'GET';
      const status = '200';
      const path = '/api/v1/users';
      const duration = 0.35;

      // When (Act)
      service.recordMetrics(method, status, path, duration);
      const metrics = await service.getMetrics();

      // Then (Assert)
      expect(metrics).toContain('http_requests_total');
      expect(metrics).toContain('http_request_duration_seconds');
      expect(metrics).toContain('method="GET"');
      expect(metrics).toContain('status="200"');
      expect(metrics).toContain('path="/api/v1/users"');
      expect(metrics).toContain('app="tattoo-pop-api"');
    });

    it('should increment requests count when called multiple times with same labels', async () => {
      // Given (Arrange)
      const method = 'POST';
      const status = '201';
      const path = '/api/v1/tattoos';
      const duration = 0.5;

      // When (Act)
      service.recordMetrics(method, status, path, duration);
      service.recordMetrics(method, status, path, duration);
      const metrics = await service.getMetrics();

      // Then (Assert)
      expect(metrics).toMatch(
        /http_requests_total\{.*method="POST".*status="201".*path="\/api\/v1\/tattoos".*app="tattoo-pop-api".*\} 2/,
      );
    });
  });

  describe('recordError', () => {
    it('should execute recordError successfully and register error counter metrics', async () => {
      // Given (Arrange)
      const path = '/api/v1/auth/login';
      const status = '401';
      const errorCode = 'UNAUTHORIZED';
      const errorMessage = 'Invalid credentials';

      // When (Act)
      service.recordError(path, status, errorCode, errorMessage);
      const metrics = await service.getMetrics();

      // Then (Assert)
      expect(metrics).toContain('http_errors_total');
      expect(metrics).toContain('error_code="UNAUTHORIZED"');
      expect(metrics).toContain('error_message="Invalid credentials"');
      expect(metrics).toContain('status="401"');
      expect(metrics).toContain('path="/api/v1/auth/login"');
      expect(metrics).toContain('app="tattoo-pop-api"');
    });

    it('should increment error count when called multiple times with same labels', async () => {
      // Given (Arrange)
      const path = '/api/v1/appointments';
      const status = '404';
      const errorCode = 'NOT_FOUND';
      const errorMessage = 'Appointment not found';

      // When (Act)
      service.recordError(path, status, errorCode, errorMessage);
      service.recordError(path, status, errorCode, errorMessage);
      const metrics = await service.getMetrics();

      // Then (Assert)
      expect(metrics).toMatch(
        /http_errors_total\{.*path="\/api\/v1\/appointments".*status="404".*error_code="NOT_FOUND".*error_message="Appointment not found".*app="tattoo-pop-api".*\} 2/,
      );
    });
  });

  describe('getMetrics', () => {
    it('should execute getMetrics successfully and return default metrics including app label', async () => {
      // Given (Arrange)

      // When (Act)
      const metrics = await service.getMetrics();

      // Then (Assert)
      expect(typeof metrics).toBe('string');
      expect(metrics.length).toBeGreaterThan(0);
      expect(metrics).toContain('app="tattoo-pop-api"');
      expect(metrics).toContain('process_cpu_user_seconds_total');
    });
  });
});

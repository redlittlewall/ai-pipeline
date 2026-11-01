const mockStripe = {
  customers: { create: jest.fn() },
  ephemeralKeys: { create: jest.fn() },
  paymentIntents: {
    retrieve: jest.fn(),
    create: jest.fn(),
    confirm: jest.fn(),
    cancel: jest.fn(),
    update: jest.fn(),
  },
  transfers: { create: jest.fn() },
  refunds: { create: jest.fn() },
};
jest.mock('stripe', () => jest.fn(() => mockStripe));

import { Test, TestingModule } from '@nestjs/testing';
import { StripeService, REFOUND_REASON } from './StripeService';

describe('StripeService', () => {
  let service: StripeService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [StripeService],
    }).compile();

    service = module.get<StripeService>(StripeService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createCustomer', () => {
    it('should execute createCustomer successfully', async () => {
      mockStripe.customers.create.mockResolvedValueOnce({
        id: 'cus_123',
      } as any);
      const result = await service.createCustomer({
        username: 'test',
        email: 'test@test.com',
      } as any);
      expect(result).toBeDefined();
      expect(mockStripe.customers.create).toHaveBeenCalled();
    });
  });

  describe('createCustomerEphemeralKey', () => {
    it('should execute createCustomerEphemeralKey successfully', async () => {
      mockStripe.ephemeralKeys.create.mockResolvedValueOnce({
        id: 'eph_123',
      } as any);
      const result = await service.createCustomerEphemeralKey('cus_123');
      expect(result).toBeDefined();
      expect(mockStripe.ephemeralKeys.create).toHaveBeenCalledWith(
        { customer: 'cus_123' },
        { apiVersion: '2024-06-20' },
      );
    });
  });

  describe('getPaymentIntent', () => {
    it('should execute getPaymentIntent successfully', async () => {
      mockStripe.paymentIntents.retrieve.mockResolvedValueOnce({
        id: 'pi_123',
      } as any);
      const result = await service.getPaymentIntent('pi_123');
      expect(result).toBeDefined();
      expect(mockStripe.paymentIntents.retrieve).toHaveBeenCalledWith('pi_123');
    });
  });

  describe('getPixPaymentStatus', () => {
    it('should execute getPixPaymentStatus successfully', async () => {
      mockStripe.paymentIntents.retrieve.mockResolvedValueOnce({
        id: 'pi_123',
        status: 'succeeded',
      } as any);
      const result = await service.getPixPaymentStatus('pi_123');
      expect(result.status).toBe('succeeded');
    });

    it('should throw error when retrieve fails', async () => {
      mockStripe.paymentIntents.retrieve.mockRejectedValueOnce(
        new Error('Stripe error'),
      );
      await expect(service.getPixPaymentStatus('pi_123')).rejects.toThrow(
        'Erro ao buscar status do pagamento PIX: Stripe error',
      );
    });
  });

  describe('createPaymentIntent', () => {
    it('should execute createPaymentIntent successfully', async () => {
      mockStripe.paymentIntents.create.mockResolvedValueOnce({
        id: 'pi_123',
      } as any);
      const result = await service.createPaymentIntent(
        100,
        'Artist',
        'art_1',
        'cli_1',
        'price_1',
        'cus_1',
      );
      expect(result).toBeDefined();
      expect(mockStripe.paymentIntents.create).toHaveBeenCalled();
    });

    it('should throw error when creation fails', async () => {
      mockStripe.paymentIntents.create.mockRejectedValueOnce(new Error('Fail'));
      await expect(
        service.createPaymentIntent(100, 'A', '1', '1', '1', '1'),
      ).rejects.toThrow();
    });
  });

  describe('confirmPixPaymentIntent', () => {
    it('should confirm and log success when next_action is pix_display_qr_code', async () => {
      mockStripe.paymentIntents.confirm.mockResolvedValueOnce({
        id: 'pi_123',
        status: 'requires_action',
        next_action: { type: 'pix_display_qr_code' },
      } as any);

      const result = await service.confirmPixPaymentIntent('pi_123');
      expect(result.next_action.type).toBe('pix_display_qr_code');
    });

    it('should throw error when confirm fails', async () => {
      mockStripe.paymentIntents.confirm.mockRejectedValueOnce(
        new Error('Fail'),
      );
      await expect(service.confirmPixPaymentIntent('pi_123')).rejects.toThrow();
    });
  });

  describe('confirmBoletoPaymentIntent', () => {
    it('should execute confirmBoletoPaymentIntent successfully', async () => {
      mockStripe.paymentIntents.confirm.mockResolvedValueOnce({
        id: 'pi_123',
      } as any);
      const result = await service.confirmBoletoPaymentIntent(
        'pi_123',
        '123',
        'Name',
        'email@test.com',
      );
      expect(result).toBeDefined();
      expect(mockStripe.paymentIntents.confirm).toHaveBeenCalled();
    });
  });

  describe('cancelPaymentIntent', () => {
    it('should execute cancelPaymentIntent successfully', async () => {
      mockStripe.paymentIntents.cancel.mockResolvedValueOnce({
        id: 'pi_123',
        status: 'canceled',
      } as any);
      const result = await service.cancelPaymentIntent('pi_123');
      expect(result.status).toBe('canceled');
    });
  });

  describe('updatePaymentIntentPrice', () => {
    it('should execute updatePaymentIntentPrice successfully', async () => {
      mockStripe.paymentIntents.update.mockResolvedValueOnce({
        id: 'pi_123',
        amount: 200,
      } as any);
      const result = await service.updatePaymentIntentPrice('pi_123', {
        totalValue: 200,
      } as any);
      expect(result.amount).toBe(200);
    });
  });

  describe('createTransaction', () => {
    it('should execute createTransaction successfully', async () => {
      mockStripe.transfers.create.mockResolvedValueOnce({
        id: 'tr_123',
      } as any);
      const result = await service.createTransaction(
        'bud_1',
        'acc_1',
        'ch_1',
        'brl',
        100,
      );
      expect(result).toBeDefined();
      expect(mockStripe.transfers.create).toHaveBeenCalled();
    });

    it('should throw error when transfer fails', async () => {
      mockStripe.transfers.create.mockRejectedValueOnce(new Error('Fail'));
      await expect(
        service.createTransaction('1', '1', '1', 'brl', 100),
      ).rejects.toThrow();
    });
  });

  describe('refoundPaymentIntent', () => {
    it('should execute refoundPaymentIntent successfully', async () => {
      mockStripe.paymentIntents.retrieve.mockResolvedValueOnce({
        id: 'pi_123',
      } as any);
      mockStripe.refunds.create.mockResolvedValueOnce({ id: 'ref_123' } as any);

      await service.refoundPaymentIntent(
        'pi_123',
        100,
        REFOUND_REASON.REQUESTED_BY_CUSTOMER,
      );

      expect(mockStripe.refunds.create).toHaveBeenCalledWith({
        payment_intent: 'pi_123',
        amount: 100,
        reason: REFOUND_REASON.REQUESTED_BY_CUSTOMER,
      });
    });
  });
});

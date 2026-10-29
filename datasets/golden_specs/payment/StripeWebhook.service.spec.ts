import { Test, TestingModule } from '@nestjs/testing';
import { StripeWebhookService } from './StripeWebhook.service';
import { HandleSucessPaymentService } from '../actions/HandleSucessPayment.service';
import { HandleFailedPaymentService } from '../actions/HandleFailedPayment.service';
import { HandleAccountUpdatedService } from './HandleAccountUpdated.service';
import { HandlePayoutUpdatedService } from '../actions/HandlePayoutUpdated.Service';

describe('StripeWebhookService', () => {
  let service: StripeWebhookService;
  let handleSucessPaymentService: any;
  let handleFailedPaymentService: any;
  let handleAccountUpdatedService: any;
  let handlePayoutUpdatedService: any;

  beforeEach(async () => {
    handleSucessPaymentService = {
      handle: jest.fn(),
    };
    handleFailedPaymentService = {
      handle: jest.fn(),
    };
    handleAccountUpdatedService = {
      handle: jest.fn(),
    };
    handlePayoutUpdatedService = {
      handle: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StripeWebhookService,
        {
          provide: HandleSucessPaymentService,
          useValue: handleSucessPaymentService,
        },
        {
          provide: HandleFailedPaymentService,
          useValue: handleFailedPaymentService,
        },
        {
          provide: HandleAccountUpdatedService,
          useValue: handleAccountUpdatedService,
        },
        {
          provide: HandlePayoutUpdatedService,
          useValue: handlePayoutUpdatedService,
        },
      ],
    }).compile();

    service = module.get<StripeWebhookService>(StripeWebhookService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('handleEvent', () => {
    it('should execute handleEvent successfully with unknown event type (no error)', async () => {
      const consoleSpy = jest
        .spyOn(console, 'log')
        .mockImplementation(() => {});
      const result = await service.handleEvent({
        type: 'unknown.event',
        data: {},
      } as any);
      expect(result).toBeUndefined();
      expect(consoleSpy).toHaveBeenCalledWith(
        'Unhandled event type unknown.event',
      );
      consoleSpy.mockRestore();
    });

    it('should handle charge.succeeded without invoking any handlers', async () => {
      const event = {
        type: 'charge.succeeded',
        data: {
          object: {
            payment_intent: 'pi_123',
          },
        },
      } as any;

      const result = await service.handleEvent(event);
      expect(result).toBeUndefined();
      expect(handleSucessPaymentService.handle).not.toHaveBeenCalled();
      expect(handleFailedPaymentService.handle).not.toHaveBeenCalled();
      expect(handleAccountUpdatedService.handle).not.toHaveBeenCalled();
      expect(handlePayoutUpdatedService.handle).not.toHaveBeenCalled();
    });

    it('should invoke HandlePayoutUpdatedService.handle on payout.paid event', async () => {
      const payout = {
        destination: 'dest_abc',
        id: 'po_456',
        trace_id: 'trace_789',
        balance_transaction: 'bt_001',
        arrival_date: 1_700_000_000,
        amount: 5000,
        currency: 'usd',
      };
      const event = {
        type: 'payout.paid',
        data: { object: payout },
      } as any;

      const result = await service.handleEvent(event);
      expect(result).toBeUndefined();
      expect(handlePayoutUpdatedService.handle).toHaveBeenCalledTimes(1);
      // The last argument is a Date instance; we verify its type.
      const callArgs = handlePayoutUpdatedService.handle.mock.calls[0];
      expect(callArgs[0]).toBe(payout.destination);
      expect(callArgs[1]).toBe(payout.id);
      expect(callArgs[2]).toBe(payout.trace_id);
      expect(callArgs[3]).toBe(payout.balance_transaction);
      expect(callArgs[4]).toBe(payout.arrival_date);
      expect(callArgs[5]).toBe(payout.amount);
      expect(callArgs[6]).toBe(payout.currency);
      expect(callArgs[7] instanceof Date).toBeTruthy();
    });

    it('should invoke HandleSucessPaymentService.handle on payment_intent.succeeded event', async () => {
      const paymentIntent = {
        id: 'pi_123',
        latest_charge: 'ch_456',
      };
      const event = {
        type: 'payment_intent.succeeded',
        data: { object: paymentIntent },
      } as any;

      const result = await service.handleEvent(event);
      expect(result).toBeUndefined();
      expect(handleSucessPaymentService.handle).toHaveBeenCalledWith(
        paymentIntent.id,
        paymentIntent.latest_charge,
      );
    });

    it('should invoke HandleFailedPaymentService.handle on payment_intent.payment_failed event', async () => {
      const paymentIntentFailed = {
        id: 'pi_failed_123',
      };
      const event = {
        type: 'payment_intent.payment_failed',
        data: { object: paymentIntentFailed },
      } as any;

      const result = await service.handleEvent(event);
      expect(result).toBeUndefined();
      expect(handleFailedPaymentService.handle).toHaveBeenCalledWith(
        paymentIntentFailed.id,
      );
    });

    it('should invoke HandleAccountUpdatedService.handle on account.updated event', async () => {
      const account = { id: 'acct_123', email: 'test@example.com' } as any;
      const event = {
        type: 'account.updated',
        data: { object: account },
      } as any;

      const result = await service.handleEvent(event);
      expect(result).toBeUndefined();
      expect(handleAccountUpdatedService.handle).toHaveBeenCalledWith(account);
    });

    it('should propagate errors from injected services and log them', async () => {
      const error = new Error('boom');
      handleSucessPaymentService.handle.mockImplementationOnce(() => {
        throw error;
      });

      const event = {
        type: 'payment_intent.succeeded',
        data: { object: { id: 'pi_err', latest_charge: 'ch_err' } },
      } as any;

      const loggerErrorSpy = jest.spyOn((service as any).logger, 'error');

      await expect(service.handleEvent(event)).rejects.toThrow(error);
      expect(loggerErrorSpy).toHaveBeenCalledWith(error);
      loggerErrorSpy.mockRestore();
    });
  });
});

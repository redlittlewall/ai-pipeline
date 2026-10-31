import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { GetListOfBanksService } from './GetListOfBanks.service';
import { BankEntity } from 'model/payment/Bank.entity';

describe('GetListOfBanksService', () => {
  let service: GetListOfBanksService;
  let bankEntityRepository: any;

  beforeEach(async () => {
    bankEntityRepository = {
      find: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GetListOfBanksService,
        {
          provide: getRepositoryToken(BankEntity),
          useValue: bankEntityRepository,
        },
      ],
    }).compile();

    service = module.get<GetListOfBanksService>(GetListOfBanksService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('get', () => {
    it('should return list of banks ordered by code ASC', async () => {
      const mockBanks = [
        { id: 1, code: '001', name: 'Banco do Brasil' },
        { id: 2, code: '237', name: 'Bradesco' },
      ];
      bankEntityRepository.find.mockResolvedValueOnce(mockBanks);

      const result = await service.get();

      expect(result).toEqual(mockBanks);
      expect(bankEntityRepository.find).toHaveBeenCalledWith({
        order: { code: 'ASC' },
      });
    });

    it('should throw NotFoundException when bankEntityRepository returns empty array', async () => {
      bankEntityRepository.find.mockResolvedValueOnce([]);

      await expect(service.get()).rejects.toThrow(NotFoundException);
      await expect(service.get()).rejects.toThrow('Banks not found');
    });

    it('should throw NotFoundException when bankEntityRepository returns null', async () => {
      bankEntityRepository.find.mockResolvedValueOnce(null);

      await expect(service.get()).rejects.toThrow(NotFoundException);
    });
  });
});

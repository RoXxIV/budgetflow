import * as utilityMeterService from "../services/utilityMeter.service.js";

export const getAll = async (req, res) => {
  const meters = await utilityMeterService.getAll();
  res.json(meters);
};

export const create = async (req, res) => {
  const meter = await utilityMeterService.create(req.body);
  res.status(201).json(meter);
};

export const update = async (req, res) => {
  const meter = await utilityMeterService.update(req.params.id, req.body);
  if (!meter) return res.status(404).json({ message: "Compteur introuvable" });
  res.json(meter);
};

export const remove = async (req, res) => {
  const meter = await utilityMeterService.remove(req.params.id);
  if (!meter) return res.status(404).json({ message: "Compteur introuvable" });
  res.json({ message: "Compteur supprimé" });
};

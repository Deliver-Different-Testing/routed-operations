namespace RoutedOperations.Core.Application.Dtos.BulkImport.Common
{
    public class RateDto
    {
        public int SpeedId { get; set; }
        public string ServiceName { get; set; }
        public string ServiceDescription { get; set; }
        public decimal Amount { get; set; }
        public string CutoffTime { get; set; }
        public string PickupETA { get; set; }
        public string DeliveryETA { get; set; }
        public int Duration { get; set; }
        public string BookDate { get; set; }
        public string AvailabilityColour { get; set; }
        public bool Selected { get; set; }
        public string QuoteId { get; set; }
    }
}

using System;
using System.Collections.Generic;
using System.ComponentModel.DataAnnotations;
using System.ComponentModel;
using System.Linq;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using System.Runtime.Serialization;
using Microsoft.VisualBasic.CompilerServices;

namespace RoutedOperations.Core.Application.Dtos.BulkImport.Bulk
{
    public class PickupJobToCreateDto
    {
        public String BookedBy { get; set; }
        public String FromAddress { get; set; }
        public String FromSuburb { get; set; }
        public int? FromPostCode { get; set; }
        public String Speed { get; set; }
        public int? SpeedID { get; set; }
        public String ToAddress { get; set; }
        public String ToSuburb { get; set; }
        public int ToPostCode { get; set; }
        public String ToAddressType { get; set; }
        public String ReferenceA { get; set; }
        public String ReferenceB { get; set; }
        public String Size { get; set; }
        public String Weight { get; set; }
        public String Return { get; set; }
        public String CourierNotes { get; set; }
        public String ClientNotes { get; set; }
        public String FromContactName { get; set; }
        public String FromPhoneNumber { get; set; }
        public String ToContactName { get; set; }
        public String ToPhoneNumber { get; set; }
        public String Type { get; set; }
        public String PickUpFrom { get; set; }
        public int? Quantity { get; set; }
        public String LeaveNotHome { get; set; }
        public String JobNotificationType { get; set; }
        public String JobNotificationEmail { get; set; }
        public String JobNotificationMobile { get; set; }
        public String ToAddressCode { get; set; }
        public String FromAddressCode { get; set; }
        public int ClientID { get; set; }
        public DateTime Time { get; set; }
        public bool? Hold { get; set; }
        public float? FixedAmount { get; set; }
        public int? JobID { get; set; }
        public float? AgentAmount { get; set; }
        public int? AgentCourierID { get; set; }
        public float? FuelSurchargeAmount { get; set; }
        public String OurRef { get; set; }
        public String Message { get; set; }
        public String PickUpLatitude { get; set; }
        public String PickUpLongitude { get; set; }
        public String DeliveryLatitude { get; set; }
        public String DeliveryLongitude { get; set; }
        public decimal? Kms { get; set; }
        public int? DGClass { get; set; }
        public bool? DGDocument { get; set; }
        public int? ShopId { get; set; }
        public String ShopRef1 { get; set; }
        public String ShopRef2 { get; set; }
        public String ShopRef3 { get; set; }
        public String ShopRef4 { get; set; }
        public String ShopRef5 { get; set; }
    }
}


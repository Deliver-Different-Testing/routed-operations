using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using System.Web;
using UCLRun.Models.Interface;

namespace UCLRun.Models.Repository
{
    public class CourierRepository : ICourierRepository
    {
        private DespatchContext context = new DespatchContext();

        public IEnumerable GetPotentialCouriers()
        {
            var result = context.GetPotentialCouriers().ToList();
            return result;
        }
    }
}